/** The model package ships no typings: `./node` is the absolute paths of its assets. */
declare module "@gutenye/ocr-models/node" {
  const paths: { detectionPath: string; recognitionPath: string; dictionaryPath: string }
  export default paths
}
