import * as O from "fp-ts/Option"

type SafeParseJSON = {
  (str: string, convertToArray: true): O.Option<Array<unknown>>
  (str: string, convertToArray?: false): O.Option<Record<string, unknown>>
}

/**
 * Checks and parses a JSON string.
 *
 * Trimmed from hoppscotch-common's helpers/functional/json - the importers
 * only need this one function, and the rest pulled in @hoppscotch/kernel.
 *
 * @param str Raw JSON data to be parsed
 * @returns Option type with some(JSON data) or none
 */
export const safeParseJSON: SafeParseJSON = (str, convertToArray = false) =>
  O.tryCatch(() => {
    const data = JSON.parse(str)
    if (convertToArray) {
      return Array.isArray(data) ? data : [data]
    }
    return data
  })

/**
 * Prettified JSON representation of a value.
 * @param obj The object to represent
 * @returns Option of the prettified JSON string
 */
export const prettyPrintJSON = (obj: unknown): O.Option<string> =>
  O.tryCatch(() => JSON.stringify(obj, null, 2))
