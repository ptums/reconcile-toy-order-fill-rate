import { Kind, parse, visit } from "graphql";

const MUTATION_COST = 10;
const DEFAULT_FIRST: Record<string, number> = { orders: 1, lineItems: 50 };

export function queryCost(query: string): number {
  let cost = 0;
  try {
    visit(parse(query), {
      OperationDefinition(node) {
        if (node.operation === "mutation") cost += MUTATION_COST;
      },
      Field(node) {
        const first = node.arguments?.find((a) => a.name.value === "first");
        if (first?.value.kind === Kind.INT) cost += Number(first.value.value);
        else cost += DEFAULT_FIRST[node.name.value] ?? 0;
      },
    });
  } catch {
    // a query that does not parse: Yoga reports the syntax error
  }
  return Math.max(cost, 1);
}
