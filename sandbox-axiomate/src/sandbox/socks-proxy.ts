import { createServer } from '@pondwader/socks5-server';
import { logForDebugging } from '../utils/debug.js';

export interface SocksProxyOptions {
    filter: (port: number, hostname: string) => Promise<boolean>;
}

export interface SocksProxyServer {
    server: any;
    getPort(): number | undefined;
    listen(port: number, hostname: string): Promise<number>;
    close(): Promise<void>;
    unref(): void;
}

export function createSocksProxyServer(options: SocksProxyOptions): SocksProxyServer {
    const socksServer = createServer();
    socksServer.setRulesetValidator(async (conn: any) => {
        try {
            const hostname: string = conn.destAddress;
            const port: number = conn.destPort;
            logForDebugging(`Connection request to ${hostname}:${port}`);
            const allowed = await options.filter(port, hostname);
            if (!allowed) {
                logForDebugging(`Connection blocked to ${hostname}:${port}`, {
                    level: 'error',
                });
                return false;
            }
            logForDebugging(`Connection allowed to ${hostname}:${port}`);
            return true;
        }
        catch (error) {
            logForDebugging(`Error validating connection: ${error}`, {
                level: 'error',
            });
            return false;
        }
    });
    return {
        server: socksServer,
        getPort(): number | undefined {
            // Access the internal server to get the port
            // We need to use type assertion here as the server property is private
            try {
                const serverInternal = (socksServer as any)?.server;
                if (serverInternal && typeof serverInternal?.address === 'function') {
                    const address: any = serverInternal.address();
                    if (address && typeof address === 'object' && 'port' in address) {
                        return address.port;
                    }
                }
            }
            catch (error) {
                // Server might not be listening yet or property access failed
                logForDebugging(`Error getting port: ${error}`, { level: 'error' });
            }
            return undefined;
        },
        listen(port: number, hostname: string): Promise<number> {
            return new Promise<number>((resolve, reject) => {
                const listeningCallback = (): void => {
                    const actualPort = this.getPort();
                    if (actualPort) {
                        logForDebugging(`SOCKS proxy listening on ${hostname}:${actualPort}`);
                        resolve(actualPort);
                    }
                    else {
                        reject(new Error('Failed to get SOCKS proxy server port'));
                    }
                };
                socksServer.listen(port, hostname, listeningCallback);
            });
        },
        async close(): Promise<void> {
            return new Promise<void>((resolve, reject) => {
                socksServer.close((error: any) => {
                    if (error) {
                        // Only reject for actual errors, not for "already closed" states
                        // Check for common "already closed" error patterns
                        const errorMessage = error.message?.toLowerCase() || '';
                        const isAlreadyClosed = errorMessage.includes('not running') ||
                            errorMessage.includes('already closed') ||
                            errorMessage.includes('not listening');
                        if (!isAlreadyClosed) {
                            reject(error);
                            return;
                        }
                    }
                    resolve();
                });
            });
        },
        unref(): void {
            // Access the internal server to call unref
            try {
                const serverInternal = (socksServer as any)?.server;
                if (serverInternal && typeof serverInternal?.unref === 'function') {
                    serverInternal.unref();
                }
            }
            catch (error) {
                logForDebugging(`Error calling unref: ${error}`, { level: 'error' });
            }
        },
    };
}