export interface BuilderModelOption {
  uuid: string;
  id: string;
  name: string;
  description: string;
  tags: string[];
  selection_hint?: string | null;
  advanced_info?: string | null;
  context_length: number;
  input_price: number;
  output_price: number;
  is_reasoning: boolean;
  is_active: boolean;
}

export function normalizeModelTags(tags?: string[] | null) {
  return (tags ?? []).reduce<string[]>((nextTags, tag) => {
    const normalizedTag = tag.trim();
    if (!normalizedTag) return nextTags;
    if (nextTags.some((value) => value.toLowerCase() === normalizedTag.toLowerCase())) return nextTags;
    nextTags.push(normalizedTag);
    return nextTags;
  }, []);
}

export function getPrimaryModelTag(tags?: string[] | null) {
  return normalizeModelTags(tags)[0] ?? "";
}

export function getSecondaryModelTags(tags?: string[] | null) {
  return normalizeModelTags(tags).slice(1);
}

export const preferredTagOrder = ["steady", "swift", "deep"];

export function getModelTagRank(tags?: string[] | null) {
  const normalized = getPrimaryModelTag(tags).toLowerCase();
  const index = preferredTagOrder.indexOf(normalized);
  return index === -1 ? preferredTagOrder.length : index;
}

export function formatModelTag(tag?: string | null) {
  const normalized = (tag ?? "").trim();
  return normalized || "General";
}

export function formatModelPrice(value: number) {
  if (value === 0) return "Free";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: value < 1 ? 2 : 0,
  }).format(value);
}

export function getFirstSentence(text: string, maxLen = 100): string {
  const match = text.match(/^[^.!?\n]+[.!?]?/);
  const sentence = match ? match[0].trim() : text.trim();
  return sentence.length <= maxLen ? sentence : sentence.slice(0, maxLen).trim() + "…";
}
