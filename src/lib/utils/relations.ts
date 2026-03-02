import type {Prisma} from "@prisma/client";
import type {BaseDMMF} from "@prisma/client/runtime/client";

// Prisma 7 removed `isList` from DMMF field metadata. Compute it by checking
// whether a scalar FK field (e.g. `groupId` for relation `group`) exists on the
// model — if it does, the relation is toOne (isList=false), otherwise toMany.
//
// Limitation: this heuristic cannot distinguish the non-FK side of a 1-1
// relation (e.g. `User.profile Profile?`) from the non-FK side of a 1-many
// relation (e.g. `User.posts Post[]`) — both have no FK on the current model.
// Pass `inlineSchema` to `getRelationsByModel` for accurate results.
function computeIsList(model: Prisma.DMMF.Model, relationField: Prisma.DMMF.Field): boolean {
    const potentialFkName = `${relationField.name}Id`;
    const hasFkField = model.fields.some(
        (f) => f.name === potentialFkName && f.kind === "scalar"
    );
    return !hasFkField;
}

// Parse the Prisma schema text to extract isList for every model field.
// Returns Map<modelName, Map<fieldName, isList>>.
// This is the only reliable way to determine isList in Prisma 7 because the
// DMMF no longer includes that metadata.
function parseIsListFromSchema(inlineSchema: string): Map<string, Map<string, boolean>> {
    const result = new Map<string, Map<string, boolean>>();

    // Match each model block: model Foo { ... }
    // Use a loop rather than a global regex with `s` flag for compat
    let remaining = inlineSchema;
    const modelStart = /\bmodel\s+(\w+)\s*\{/;

    while (remaining.length > 0) {
        const startMatch = modelStart.exec(remaining);
        if (!startMatch) break;

        const modelName = startMatch[1];
        const bodyStart = startMatch.index + startMatch[0].length;

        // Find the matching closing brace
        let depth = 1;
        let i = bodyStart;
        while (i < remaining.length && depth > 0) {
            if (remaining[i] === "{") depth++;
            else if (remaining[i] === "}") depth--;
            i++;
        }

        const modelBody = remaining.slice(bodyStart, i - 1);
        remaining = remaining.slice(i);

        const fieldMap = new Map<string, boolean>();

        for (const line of modelBody.split("\n")) {
            const trimmed = line.trim();
            // Skip comments and blank lines
            if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
                continue;
            }
            // Match: fieldName  TypeName  ([] | ? | <nothing>)  (optional attrs)
            const fieldMatch = /^(\w+)\s+(\w+)(\[]|\?)?/.exec(trimmed);
            if (fieldMatch) {
                const fieldName = fieldMatch[1];
                const modifier = fieldMatch[3]; // '[]', '?', or undefined
                fieldMap.set(fieldName, modifier === "[]");
            }
        }

        result.set(modelName, fieldMap);
    }

    return result;
}

export function getRelationsByModel(
    dmmf: BaseDMMF,
    inlineSchema?: string
): Record<string, Prisma.DMMF.Field[]> {
    const schemaIsListMap = inlineSchema ? parseIsListFromSchema(inlineSchema) : null;

    const relationsByModel: Record<string, Prisma.DMMF.Field[]> = {};
    dmmf.datamodel.models.forEach((model: Prisma.DMMF.Model) => {
        relationsByModel[model.name] = model.fields
            .filter((field) => field.kind === "object" && field.relationName)
            .map((field) => {
                let isList: boolean;

                if ((field as any).isList !== undefined) {
                    // Prisma 4/5: isList present in DMMF directly
                    isList = (field as any).isList;
                } else {
                    // Prisma 7+: use parsed schema for accurate isList.
                    // schemaIsListMap is guaranteed to be set here because
                    // withNestedOperations throws if inlineSchema is missing on Prisma 7.
                    const modelFields = schemaIsListMap!.get(model.name);
                    isList = modelFields?.get(field.name) ?? computeIsList(model, field);
                }

                return {...field, isList};
            });
    });
    return relationsByModel;
}

export function findOppositeRelation(
    relationsByModel: Record<string, Prisma.DMMF.Field[]>,
    relation: Prisma.DMMF.Field
): Prisma.DMMF.Field {
    const parentRelations =
        relationsByModel[relation.type as Prisma.ModelName] || [];

    const oppositeRelation = parentRelations.find(
        (parentRelation) =>
            parentRelation !== relation &&
            parentRelation.relationName === relation.relationName
    );

    if (!oppositeRelation) {
        throw new Error(`Unable to find opposite relation to ${relation.name}`);
    }

    return oppositeRelation;
}
