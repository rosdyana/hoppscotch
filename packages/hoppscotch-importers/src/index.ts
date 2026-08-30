/**
 * Shared collection importers.
 *
 * Extracted from hoppscotch-common so the app, the backend's agent tool layer
 * and the CLI all convert Postman / Insomnia / OpenAPI / HAR files with the
 * same code. These are pure functions - no Vue, no DOM, no store access.
 */
export { IMPORTER_INVALID_FILE_FORMAT } from "./errors"
export type { HoppImporterError } from "./errors"

export { hoppPostmanImporter } from "./postman"
export { postmanEnvImporter } from "./postmanEnv"
export { harImporter } from "./har"
export { hoppRESTImporter } from "./hopp"
export { hoppInsomniaImporter } from "./insomnia/insomniaColl"
export {
  insomniaEnvImporter,
  replaceInsomniaTemplating,
} from "./insomnia/insomniaEnv"
export {
  hoppOpenAPIImporter,
  convertOpenApiDocsToHopp,
  splitTagSegments,
  hasSharedTagPathPrefix,
  pickRequestFolderSegments,
  OPENAPI_DEREF_ERROR,
} from "./openapi"
export type { OpenAPIDocProcessors } from "./openapi"
