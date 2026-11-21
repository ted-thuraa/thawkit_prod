import { QUIZ_SAMPLE } from "@/lib/quiz/sample";
import { buildSampleFieldPlan } from "@/lib/editor/write/sample-fields";
import { resolveQuizSchema, type QuizSchema } from "@/lib/quiz";

/** The Quiz schema exactly as `createSampleCollection` would persist it (ids = "f:<key>"). */
export function sampleFields() {
  return buildSampleFieldPlan(QUIZ_SAMPLE, (() => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  })()).map((f) => ({
    id: f.id,
    key: f.persistKey,
    type: f.type,
    data: f.data,
    name: f.name,
    default: f.defaultValue,
  }));
}

export function sampleSchema(): QuizSchema {
  const schema = resolveQuizSchema(sampleFields());
  if (!schema) throw new Error("sample is not quiz-shaped");
  return schema;
}
