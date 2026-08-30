/** Hoppscotch template syntax: <<VARIABLE_NAME>>. */
const TEMPLATE_PATTERN = /<<([a-zA-Z0-9_\-.]+)>>/g;

export type EnvVariable = { key: string; value?: string; secret?: boolean };

/** Substitute <<VAR>> references, leaving unknown ones untouched. */
export function interpolate(
  input: string,
  variables: EnvVariable[],
): string {
  if (!input) return input;

  const lookup = new Map(
    variables.map((variable) => [variable.key, variable.value ?? '']),
  );

  return input.replace(TEMPLATE_PATTERN, (match, key: string) =>
    lookup.has(key) ? lookup.get(key)! : match,
  );
}

/** Deeply interpolate every string in a request-shaped structure. */
export function interpolateDeep<T>(value: T, variables: EnvVariable[]): T {
  if (typeof value === 'string') {
    return interpolate(value, variables) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateDeep(item, variables)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = interpolateDeep(item, variables);
    }
    return out as T;
  }
  return value;
}
