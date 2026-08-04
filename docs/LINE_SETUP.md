# LINE Conversational Prototype Setup

The automated and synthetic path requires no LINE or Vertex credentials:

```bash
npm ci --ignore-scripts
npm run smoke:line
```

This exercises signed synthetic DM, group, and legacy-room events through signature verification, opaque workspace mapping, event deduplication, isolated Chat persistence, a deterministic model fake, and the LINE reply seam.

## Live fictional smoke prerequisites

Do not introduce real conversation or health content at this stage. The current prototype persists conversation text in Firestore and does not yet implement the required user-facing retention and deletion controls for real family use.

You must provide these values outside source control and chat:

| Secret/configuration | Source | Runtime name |
| --- | --- | --- |
| Messaging API channel secret | LINE Developers Console -> channel Basic settings | `MEDBUDDY_LINE_CHANNEL_SECRET` |
| Messaging API channel access token | LINE Developers Console -> Messaging API | `MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN` |
| 32-byte attachment locator encryption key | Cryptographically secure secret generated and stored outside source control/chat | `MEDBUDDY_ATTACHMENT_LOCATOR_KEY` |
| GCP project ID | GCP project hosting Firestore, Vertex, and Cloud Run | `MEDBUDDY_GCP_PROJECT_ID`, `MEDBUDDY_VERTEX_PROJECT` |

Vertex authentication uses Application Default Credentials; do not create or commit a service-account key file. The deployed runtime identity needs the minimum Firestore and Vertex permissions required to store thread messages/receipts and invoke the configured model.

Effort 2 selects these Vertex settings:

```text
MEDBUDDY_VERTEX_ENABLED=true
MEDBUDDY_VERTEX_LOCATION=global
MEDBUDDY_VERTEX_MODEL=gemini-3.6-flash
```

`gemini-3.6-flash` is the user-selected Effort 2 target. It has not yet passed
the configuration-gated fictional smoke in the target project and region. Do
not deploy Effort 2 or claim live-model verification until that smoke succeeds.

The private continuity runtime also requires:

```text
MEDBUDDY_TASKS_LOCATION=<queue-region>
MEDBUDDY_TASKS_QUEUE=<private-queue>
MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL=<task-caller-service-account>
MEDBUDDY_CONTINUITY_CALLBACK_URL=https://<cloud-run-host>/api/internal/continuity
MEDBUDDY_ATTACHMENT_CALLBACK_URL=https://<cloud-run-host>/api/internal/attachment
MEDBUDDY_ATTACHMENT_BUCKET=<private-bucket>
MEDBUDDY_ATTACHMENT_LOCATOR_KEY_VERSION=locator-v1
MEDBUDDY_ATTACHMENT_LOCATOR_KEY=<Secret Manager mapping; canonical base64 for 32 bytes>
```

The callback service must verify the task OIDC audience and service-account
identity. The bucket must remain private. Bucket/object names, provider IDs,
filenames, bytes, checksums, conversation content, summaries, and prompts must
not enter logs or model context.

Generate the locator key with a cryptographically secure tool outside chat and
store it directly in Secret Manager. Map it into Cloud Run as a secret-backed
environment variable; never place it in a command argument, `.env` file,
deployment manifest, log, or screenshot. Increment the non-secret key version
when performing an explicitly planned key rotation.

The adapter-private provider locator and attachment callback are covered by
synthetic tests. Deployment remains deferred until the configuration-gated
`gemini-3.6-flash` smoke succeeds in the target project and region.

Use Secret Manager-backed environment variables in Cloud Run. To avoid putting secret values in shell history, create the secret containers and add values interactively through standard input:

```bash
gcloud secrets create medbuddy-line-channel-secret --replication-policy=automatic
gcloud secrets versions add medbuddy-line-channel-secret --data-file=-
gcloud secrets create medbuddy-line-channel-access-token --replication-policy=automatic
gcloud secrets versions add medbuddy-line-channel-access-token --data-file=-
```

Grant the Cloud Run runtime identity access only to those secrets, then map them to the two `MEDBUDDY_LINE_*` environment variables during deployment.

## Current prototype GCP deployment

The checked-in prototype foundation uses project `med-buddy-503802`, region `us-west1`, and runtime identity `medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com`. The default Firestore Native database already exists there. The commands below are intentionally explicit and do not change the shared `gcloud` project setting.

Enable the APIs needed for source deployment, secrets, and Vertex:

```bash
gcloud services enable \
  aiplatform.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  --project=med-buddy-503802
```

Grant the existing runtime identity only the additional project-level Vertex role. It already has `roles/datastore.user` for Firestore:

```bash
gcloud projects add-iam-policy-binding med-buddy-503802 \
  --member=serviceAccount:medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com \
  --role=roles/aiplatform.user
```

Cloud Run source deployment uses the Compute Engine default service account as its build identity. Grant that identity the documented builder role:

```bash
gcloud projects add-iam-policy-binding med-buddy-503802 \
  --member=serviceAccount:643586490631-compute@developer.gserviceaccount.com \
  --role=roles/run.builder
```

After obtaining the two LINE values, create their containers and enter each value only when `gcloud` is reading standard input. Press Control-D after each value:

```bash
gcloud secrets create medbuddy-line-channel-secret \
  --replication-policy=automatic \
  --project=med-buddy-503802
gcloud secrets versions add medbuddy-line-channel-secret \
  --data-file=- \
  --project=med-buddy-503802

gcloud secrets create medbuddy-line-channel-access-token \
  --replication-policy=automatic \
  --project=med-buddy-503802
gcloud secrets versions add medbuddy-line-channel-access-token \
  --data-file=- \
  --project=med-buddy-503802
```

Grant the runtime identity access to only those two secrets:

```bash
for secret_name in medbuddy-line-channel-secret medbuddy-line-channel-access-token; do
  gcloud secrets add-iam-policy-binding "${secret_name}" \
    --project=med-buddy-503802 \
    --member=serviceAccount:medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor
done
```

From the repository root, deploy the source with a scale-to-zero, low-cost prototype ceiling. Secret versions are pinned rather than resolved from `latest` at runtime. Set `LINE_SECRET_VERSION` to the enabled version containing the validated credentials:

```bash
LINE_SECRET_VERSION=2
gcloud run deploy medbuddy-line \
  --project=med-buddy-503802 \
  --region=us-west1 \
  --source=. \
  --service-account=medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --timeout=30s \
  --set-env-vars=MEDBUDDY_GCP_PROJECT_ID=med-buddy-503802,MEDBUDDY_VERTEX_ENABLED=true,MEDBUDDY_VERTEX_PROJECT=med-buddy-503802,MEDBUDDY_VERTEX_LOCATION=global,MEDBUDDY_VERTEX_MODEL=gemini-2.5-flash \
  --set-secrets=MEDBUDDY_LINE_CHANNEL_SECRET=medbuddy-line-channel-secret:${LINE_SECRET_VERSION},MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN=medbuddy-line-channel-access-token:${LINE_SECRET_VERSION}
```

Cloud Run prints the generated HTTPS service URL. No custom domain is required. The LINE webhook URL is that service URL plus `/api/line/webhook`.

Verify the deployed revision without exposing environment values:

```bash
gcloud run services describe medbuddy-line \
  --project=med-buddy-503802 \
  --region=us-west1 \
  --format='value(status.url)'
gcloud run services logs read medbuddy-line \
  --project=med-buddy-503802 \
  --region=us-west1 \
  --limit=20
```

## LINE Developers Console

1. Register a LINE Business ID with a LINE account or email address, then create a LINE Official Account. Messaging API channels can no longer be created directly in the Developers Console.
2. In LINE Official Account Manager, enable **Messaging API**. Choose the provider carefully: LINE does not allow the channel to be moved to a different provider later.
3. Open the resulting channel in the LINE Developers Console. Copy the channel secret from **Basic settings**. In **Messaging API**, issue a channel access token. The code accepts the token as a bearer credential; for this first smoke, the console-issued token is the simplest option.
4. Store both values in Secret Manager using the standard-input commands above. Never paste them into chat, a tracked file, a command argument, or a screenshot.
5. Deploy the web application and copy its generated Cloud Run HTTPS URL.
6. Set the webhook URL to `https://<cloud-run-host>/api/line/webhook`.
7. Enable **Use webhook** and **Webhook redelivery**, then use **Verify**. The signed empty-event verification request should return `200`.
8. For group testing, enable **Allow bot to join group chats**. DMs need no group setting.
9. If LINE produces an additional automatic response, use LINE Official Account Manager response settings to disable greeting and automatic replies. Regional account-manager interfaces may hide these controls when they are already inactive.
10. Scan the QR code on the channel's **Messaging API** tab to add the Official Account as a friend.

The implementation uses LINE's documented `x-line-signature`, `webhookEventId`, `mention.mentionees[].isSelf`, and one-time `replyToken` behavior. See the official references in [`LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md`](./LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md).

## Fictional live smoke

1. Confirm the deployed revision has the expected Secret Manager mappings and ADC-backed Vertex access.
2. Use the LINE console **Verify** action and confirm HTTP `200`.
3. Send a non-medical fictional DM and confirm one model-backed reply.
4. Replay inspection is automatic; verify logs contain `line_event_completed` and no body, prompt, output, token, or LINE identifier.
5. Add the Official Account to a disposable group. Confirm an ordinary group message receives no reply, then explicitly mention the bot and confirm one reply.
6. Send a fictional medication-change question and confirm deterministic refusal rather than model advice.
7. Review Firestore to confirm the DM and group use different opaque workspace documents.

Do not proceed to real family data until privacy disclosure, retention, deletion, and a production log review are implemented and explicitly approved.

## Deployed fictional smoke record (2026-08-03)

The first live LINE conversation slice is deployed and operational:

| Item | Verified state |
| --- | --- |
| GCP project and region | `med-buddy-503802`, `us-west1` |
| Cloud Run service | `medbuddy-line` |
| Verified revision | `medbuddy-line-00002-7hm` |
| Registered LINE webhook | `https://medbuddy-line-643586490631.us-west1.run.app/api/line/webhook` |
| Runtime identity | `medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com` |
| Secret storage | Secret Manager, pinned enabled version `2`; incorrect version `1` disabled |
| Vertex model boundary | `gemini-2.5-flash`, global endpoint, ADC service identity |
| LINE webhook API test | Success, HTTP `200` |
| Live fictional DM evidence | Two metadata-only `line_event_completed` entries; no failure or duplicate entry observed in the smoke window |

No LINE user, group, message, or channel identifier; credential; prompt; model output; or conversation content is recorded in this repository. The public service URL and non-secret deployment metadata above are sufficient to reproduce and diagnose the prototype.

The Compute Engine default service account had a pre-existing project-level `roles/editor` grant when the source-build role was added. That broad legacy grant was not changed during the bot deployment because its other consumers were unknown. Review and narrow it before approving real family data.

The deployed smoke proves the fictional text loop only. It does not remove the release gates for disclosure, consent, retention, deletion, dependency remediation, or production log review.
