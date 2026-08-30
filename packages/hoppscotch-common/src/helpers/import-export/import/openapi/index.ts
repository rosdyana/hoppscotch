/**
 * OpenAPI import.
 *
 * The conversion itself lives in @hoppscotch/importers so the backend agent
 * tools and the CLI use exactly this code. What stays here is the browser
 * concern: running validation and dereferencing inside a web worker so a large
 * spec does not block the UI thread.
 */
import * as E from "fp-ts/Either"
import { OpenAPI } from "openapi-types"

import {
  hoppOpenAPIImporter as importOpenAPI,
  type OpenAPIDocProcessors,
} from "@hoppscotch/importers"

export {
  OPENAPI_DEREF_ERROR,
  convertOpenApiDocsToHopp,
  hasSharedTagPathPrefix,
  pickRequestFolderSegments,
  splitTagSegments,
} from "@hoppscotch/importers"

const worker = new Worker(
  new URL("../workers/openapi-import-worker.ts", import.meta.url),
  {
    type: "module",
  }
)

const askWorker = <T>(
  type: "validate" | "dereference",
  resultType: "VALIDATION_RESULT" | "DEREFERENCE_RESULT",
  rejection: string,
  docs: unknown
): Promise<T> =>
  new Promise((resolve, reject) => {
    worker.postMessage({ type, docs })

    worker.onmessage = (event) => {
      if (event.data.type !== resultType) return

      if (E.isLeft(event.data.data)) reject(rejection)
      else resolve(event.data.data.right as T)
    }
  })

const workerProcessors: OpenAPIDocProcessors = {
  validate: (docs) =>
    askWorker<OpenAPI.Document>(
      "validate",
      "VALIDATION_RESULT",
      "COULD_NOT_VALIDATE",
      docs
    ),
  dereference: (docs) =>
    askWorker<OpenAPI.Document>(
      "dereference",
      "DEREFERENCE_RESULT",
      "COULD_NOT_DEREFERENCE",
      docs
    ),
}

export const hoppOpenAPIImporter = (fileContents: string[]) =>
  importOpenAPI(fileContents, workerProcessors)
