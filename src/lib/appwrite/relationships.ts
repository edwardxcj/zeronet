import type { Models } from "appwrite";

function isRelationshipDocument(value: unknown): value is Models.Document {
  return (
    typeof value === "object" &&
    value !== null &&
    "$id" in value &&
    typeof value.$id === "string" &&
    value.$id.length > 0
  );
}

export function relationshipDocuments(value: unknown): Models.Document[] {
  return Array.isArray(value) ? value.filter(isRelationshipDocument) : [];
}

export function relationshipId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return isRelationshipDocument(value) ? value.$id : undefined;
}

export function relationshipIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const ids = value.map(relationshipId);
  return ids.every((id): id is string => id !== undefined) ? ids : undefined;
}
