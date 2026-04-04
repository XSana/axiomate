import { encodeSandboxedCommand } from './sandbox-utils.js';

export interface SandboxViolation {
    line: string;
    command?: string;
    encodedCommand?: string;
    timestamp: Date;
}

export type ViolationListener = (violations: SandboxViolation[]) => void;

/**
 * In-memory tail for sandbox violations
 */
export class SandboxViolationStore {
    private violations: SandboxViolation[];
    private totalCount: number;
    private maxSize: number;
    private listeners: Set<ViolationListener>;

    constructor() {
        this.violations = [];
        this.totalCount = 0;
        this.maxSize = 100;
        this.listeners = new Set();
    }
    addViolation(violation: SandboxViolation): void {
        this.violations.push(violation);
        this.totalCount++;
        if (this.violations.length > this.maxSize) {
            this.violations = this.violations.slice(-this.maxSize);
        }
        this.notifyListeners();
    }
    getViolations(limit?: number): SandboxViolation[] {
        if (limit === undefined) {
            return [...this.violations];
        }
        return this.violations.slice(-limit);
    }
    getCount(): number {
        return this.violations.length;
    }
    getTotalCount(): number {
        return this.totalCount;
    }
    getViolationsForCommand(command: string): SandboxViolation[] {
        const commandBase64 = encodeSandboxedCommand(command);
        return this.violations.filter(v => v.encodedCommand === commandBase64);
    }
    clear(): void {
        this.violations = [];
        // Don't reset totalCount when clearing
        this.notifyListeners();
    }
    subscribe(listener: ViolationListener): () => void {
        this.listeners.add(listener);
        listener(this.getViolations());
        return () => {
            this.listeners.delete(listener);
        };
    }
    private notifyListeners(): void {
        // Always notify with all violations so listeners can track the full count
        const violations = this.getViolations();
        this.listeners.forEach(listener => listener(violations));
    }
}
