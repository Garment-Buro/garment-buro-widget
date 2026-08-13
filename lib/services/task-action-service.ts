export type TaskActionIntent = "stuck" | "waiting" | "fact" | "done";

export type TaskActionDetails = {
  note: string;
  nextCheckDate?: string;
  blockerOutcome?: "helped" | "blocked";
  acceptanceCriteria?: string;
};

export type TaskActionSubmission = {
  taskId: string;
  intent: TaskActionIntent;
  details: TaskActionDetails;
  preview: string;
};

export type TaskActionSaveResult = {
  id: string;
  savedAt: string;
};

const wait = (delay: number) => new Promise((resolve) => window.setTimeout(resolve, delay));

export async function requestTaskActionHelp(blocker: string): Promise<string> {
  await wait(420);
  const subject = blocker.trim().replace(/[.!?]+$/, "");
  return `Зафиксируйте, от кого зависит следующий шаг по «${subject}», и отправьте ему один конкретный вопрос.`;
}

export async function saveTaskActionMock(submission: TaskActionSubmission): Promise<TaskActionSaveResult> {
  await wait(520);
  return {
    id: `mock-${submission.taskId}-${Date.now()}`,
    savedAt: new Date().toISOString()
  };
}
