/** Browser-provided bytes sent only to MedBuddy's server route. */
export interface BrowserAttachmentUpload {
  mimeType: string;
  bytes: Uint8Array;
}
