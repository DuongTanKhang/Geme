export type RegistrationPrivacyPolicy = {
  slug: string;
  title: string;
  status: "DRAFT" | "PUBLISHED";
  content: string;
};

export function canRegisterWithPrivacyPolicy(value: unknown): value is RegistrationPrivacyPolicy {
  if (!value || typeof value !== "object") return false;
  const policy = value as Partial<RegistrationPrivacyPolicy>;
  return policy.slug === "bao-mat"
    && policy.status === "PUBLISHED"
    && typeof policy.title === "string"
    && policy.title.trim().length > 0
    && typeof policy.content === "string"
    && policy.content.trim().length > 0;
}
