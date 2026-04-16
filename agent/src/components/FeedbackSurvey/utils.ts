// Stub: FeedbackSurvey utils — type imports from useSkillImprovementSurvey.ts.

export type FeedbackSurveyResponse = 'dismissed' | 'bad' | 'fine' | 'good'

export type FeedbackSurveyType = 'skill_improvement' | 'frustration' | string


export function logEvent(
  _eventName: string,
  _metadata?: Record<string, unknown>,
): void {
  // no-op
}
