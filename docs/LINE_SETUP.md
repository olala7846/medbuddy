# LINE Conversational Prototype Setup

## Local synthetic check

This check needs no LINE or Vertex credentials. It sends signed synthetic DM, group, and legacy-room events through signature verification, opaque workspace mapping, deduplication, isolated Chat storage, a deterministic model fake, and the LINE reply seam.

```bash
npm ci --ignore-scripts
npm run smoke:line
```

## Live fictional smoke prerequisites

Use fictional, non-medical content only. Firestore persists conversation text, but the prototype has no approved user-facing retention or deletion controls for real family use.

Keep these values out of source control and chat:

| Secret/configuration | Source | Runtime name |
| --- | --- | --- |
| Messaging API channel secret | LINE Developers Console -> channel Basic settings | `MEDBUDDY_LINE_CHANNEL_SECRET` |
| Messaging API channel access token | LINE Developers Console -> Messaging API | `MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN` |
| 32-byte attachment locator encryption key | Cryptographically secure secret generated outside source control and chat | `MEDBUDDY_ATTACHMENT_LOCATOR_KEY` |
| GCP project ID | GCP project that hosts Firestore, Vertex, and Cloud Run | `MEDBUDDY_GCP_PROJECT_ID`, `MEDBUDDY_VERTEX_PROJECT` |

Use Application Default Credentials (ADC) for Vertex. Do not create or commit a service-account key file. Give the deployed runtime only the Firestore and Vertex permissions needed to store thread messages/receipts and call the configured model.

Set the Effort 2 Vertex configuration:

```text
MEDBUDDY_VERTEX_ENABLED=true
MEDBUDDY_VERTEX_LOCATION=global
MEDBUDDY_VERTEX_MODEL=gemini-3.6-flash
MEDBUDDY_COMPACTION_VERTEX_MODEL=gemini-3.5-flash-lite
```

`gemini-3.6-flash` handles conversation and tool use. `gemini-3.5-flash-lite` handles only a bounded, one-call structured compaction summary. Do not claim live-model verification until both pass configuration-gated fictional smoke tests in the target project and region.

Configure the private continuity runtime:

```text
MEDBUDDY_TASKS_LOCATION=<queue-region>
MEDBUDDY_TASKS_QUEUE=<private-queue>
MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL=<task-caller-service-account>
MEDBUDDY_CONTINUITY_CALLBACK_URL=https://<cloud-run-host>/api/internal/continuity
MEDBUDDY_MEMORY_FORMATION_CALLBACK_URL=https://<cloud-run-host>/api/internal/memory-formation
MEDBUDDY_PASSIVE_MEMORY_CALLBACK_URL=https://<cloud-run-host>/api/internal/passive-memory
MEDBUDDY_ATTACHMENT_CALLBACK_URL=https://<cloud-run-host>/api/internal/attachment
MEDBUDDY_ATTACHMENT_BUCKET=<private-bucket>
MEDBUDDY_ATTACHMENT_LOCATOR_KEY_VERSION=locator-v1
MEDBUDDY_ATTACHMENT_LOCATOR_KEY=<Secret Manager mapping; canonical base64 for 32 bytes>
MEDBUDDY_CONTINUITY_PROFILE=production
```

`MEDBUDDY_CONTINUITY_PROFILE` defaults to `production`. Use `verification-small` only for a temporary fictional compaction exercise. It uses a 600-unit protected recent window, 1,200-unit compaction trigger, and 1,800-unit pending hard ceiling. It has a distinct policy version, so its jobs and segments cannot become production history. Restore `production` after the exercise.

Select profiles as complete pairs. `production` binds `continuity-v1` and `memory-formation-v1` with a 30,000 rendered UTF-16 formation ceiling. `verification-small` binds their verification-small counterparts with a 1,800-unit ceiling. Do not override formation thresholds individually. The formation callback accepts only bounded, OIDC-authenticated wake or recovery requests; it never accepts message content.

The callback service must verify the task OIDC audience and service-account identity. Keep the bucket private. Never put bucket or object names, provider IDs, filenames, bytes, checksums, conversation content, summaries, or prompts in logs or model context.

Generate the locator key outside chat with a cryptographically secure tool. Store it directly in Secret Manager and map it to Cloud Run as a secret-backed environment variable. Never put it in a command argument, `.env` file, deployment manifest, log, or screenshot. Increment the non-secret key version only for an explicitly planned rotation.

Synthetic tests cover the adapter-private provider locator and attachment callback. Deployment remains deferred until the configuration-gated conversation and compaction smokes pass in the target project and region.

## Optional Effort 2 exact tracing (off by default)

The older Vertex wrapper can inspect fictional compaction requests. LINE
conversation tracing now uses the selective `createAgent()` callback described
below so model and tool spans stay in one run tree. Neither mode traces the full
LINE webhook, text capture, image extraction, attachment ingestion, Google
authentication, headers, or access tokens.

Tracing is disabled unless every value is present and the flag is exactly `true`:

```text
MEDBUDDY_LANGSMITH_TRACING_ENABLED=true
MEDBUDDY_LANGSMITH_SERVICE_KEY=<dedicated Secret Manager mapping>
MEDBUDDY_LANGSMITH_PROJECT=<dedicated Effort 2 tracing project>
MEDBUDDY_LANGSMITH_WORKSPACE_ID=<LangSmith workspace ID>
MEDBUDDY_LANGSMITH_API_URL=<approved regional LangSmith API URL>
MEDBUDDY_LANGSMITH_ALLOWED_WORKSPACE_ID=<one fictional internal workspace ID>
MEDBUDDY_LANGSMITH_VERIFICATION_ID=<content-free verification label>
```

For full `createAgent()` model/tool run-tree review, use a dedicated fictional
Cloud Run revision and add:

```bash
MEDBUDDY_CREATE_AGENT_TRACING_ENABLED=true
MEDBUDDY_CREATE_AGENT_TRACE_ISOLATED_REVISION=<exact K_REVISION of the dedicated revision>
```

The agent callback is created only when that revision matches, the application
workspace equals `MEDBUDDY_LANGSMITH_ALLOWED_WORKSPACE_ID`, and the focal text
starts with `[fictional-langsmith:<verification label>]`. Do not enable this
mode on an ordinary LINE revision.

Only US GCP, EU GCP, APAC GCP, and AWS US LangSmith SaaS API URLs are allowed. Generic `LANGSMITH_*` variables do not enable tracing. The local MedBuddy workspace allowlist is never sent as trace metadata. Do not trace a request with a missing scope, a different workspace, or inline image data.

Before enabling tracing, create a dedicated LangSmith project with base 14-day retention and a short-lived workspace-scoped service key. Use a pinned Secret Manager version. Never put the key in source, `.env`, a command argument, chat, logs, or screenshots. Do not add traced runs to datasets, experiments, annotation queues, feedback, evaluators, or automation rules; these can retain or upgrade trace data beyond the base tier. Never use exact-content tracing for real family traffic.

To roll back, deploy with tracing disabled, remove the Cloud Run secret mapping, and revoke the service key. After verification, delete the dedicated LangSmith project and query it later to confirm asynchronous provider deletion. LangSmith billing or analytics metadata can persist under its policy.

Use Secret Manager-backed Cloud Run variables. To keep values out of shell history, create containers and enter values through standard input:

```bash
gcloud secrets create medbuddy-line-channel-secret --replication-policy=automatic
gcloud secrets versions add medbuddy-line-channel-secret --data-file=-
gcloud secrets create medbuddy-line-channel-access-token --replication-policy=automatic
gcloud secrets versions add medbuddy-line-channel-access-token --data-file=-
```

Grant the Cloud Run runtime identity access only to these secrets. Map them to the two `MEDBUDDY_LINE_*` variables during deployment.

## Current prototype GCP deployment

The checked-in foundation uses project `med-buddy-503802`, region `us-west1`, and runtime identity `medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com`. The default Firestore Native database already exists. The commands use explicit projects and do not change the shared `gcloud` project.

Enable the APIs for source deployment, secrets, and Vertex:

```bash
gcloud services enable \
  aiplatform.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  --project=med-buddy-503802
```

Give the existing runtime only the additional Vertex role. It already has `roles/datastore.user` for Firestore:

```bash
gcloud projects add-iam-policy-binding med-buddy-503802 \
  --member=serviceAccount:medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com \
  --role=roles/aiplatform.user
```

Cloud Run source deployment uses the Compute Engine default service account as its build identity. Give it the documented builder role:

```bash
gcloud projects add-iam-policy-binding med-buddy-503802 \
  --member=serviceAccount:643586490631-compute@developer.gserviceaccount.com \
  --role=roles/run.builder
```

After you obtain the LINE values, create secret containers and enter each value only when `gcloud` reads standard input. Press Control-D after each value:

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

gcloud secrets create medbuddy-attachment-locator-key \
  --replication-policy=automatic \
  --project=med-buddy-503802
gcloud secrets versions add medbuddy-attachment-locator-key \
  --data-file=- \
  --project=med-buddy-503802
```

The attachment locator must be canonical base64 for exactly 32 random bytes. Give the runtime identity access only to these three secrets:

```bash
for secret_name in medbuddy-line-channel-secret medbuddy-line-channel-access-token medbuddy-attachment-locator-key; do
  gcloud secrets add-iam-policy-binding "${secret_name}" \
    --project=med-buddy-503802 \
    --member=serviceAccount:medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor
done
```

From the repository root, deploy only after the conversation and compaction smokes pass. This command uses scale-to-zero and a low-cost prototype ceiling. Pin secret versions; do not resolve `latest` at runtime. Supply non-secret queue, callback, service-account, and private-bucket values. Set both version variables to enabled Secret Manager versions. Keep the locator key only in its secret mapping:

```bash
LINE_SECRET_VERSION=2
TASKS_LOCATION=us-west1
: "${LOCATOR_SECRET_VERSION:?set the enabled locator-key secret version}"
: "${TASKS_QUEUE:?set the private Cloud Tasks queue name}"
: "${TASK_CALLER_SERVICE_ACCOUNT:?set the task-caller service-account email}"
: "${ATTACHMENT_BUCKET:?set the private attachment bucket name}"
: "${CLOUD_RUN_HOST:?set the Cloud Run HTTPS origin without a trailing slash}"
gcloud run deploy medbuddy-line \
  --project=med-buddy-503802 \
  --region=us-west1 \
  --source=. \
  --service-account=medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --timeout=30s \
  --set-env-vars=MEDBUDDY_GCP_PROJECT_ID=med-buddy-503802,MEDBUDDY_VERTEX_ENABLED=true,MEDBUDDY_VERTEX_PROJECT=med-buddy-503802,MEDBUDDY_VERTEX_LOCATION=global,MEDBUDDY_VERTEX_MODEL=gemini-3.6-flash,MEDBUDDY_COMPACTION_VERTEX_MODEL=gemini-3.5-flash-lite,MEDBUDDY_TASKS_LOCATION=${TASKS_LOCATION},MEDBUDDY_TASKS_QUEUE=${TASKS_QUEUE},MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL=${TASK_CALLER_SERVICE_ACCOUNT},MEDBUDDY_CONTINUITY_CALLBACK_URL=${CLOUD_RUN_HOST}/api/internal/continuity,MEDBUDDY_MEMORY_FORMATION_CALLBACK_URL=${CLOUD_RUN_HOST}/api/internal/memory-formation,MEDBUDDY_PASSIVE_MEMORY_CALLBACK_URL=${CLOUD_RUN_HOST}/api/internal/passive-memory,MEDBUDDY_ATTACHMENT_CALLBACK_URL=${CLOUD_RUN_HOST}/api/internal/attachment,MEDBUDDY_ATTACHMENT_BUCKET=${ATTACHMENT_BUCKET},MEDBUDDY_ATTACHMENT_LOCATOR_KEY_VERSION=locator-v1 \
  --set-secrets=MEDBUDDY_LINE_CHANNEL_SECRET=medbuddy-line-channel-secret:${LINE_SECRET_VERSION},MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN=medbuddy-line-channel-access-token:${LINE_SECRET_VERSION},MEDBUDDY_ATTACHMENT_LOCATOR_KEY=medbuddy-attachment-locator-key:${LOCATOR_SECRET_VERSION}
```

The task caller needs permission to enqueue on the named private queue and invoke Cloud Run with OIDC. Callback code also requires a token audience equal to each configured callback URL and a token email equal to `MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL`. Keep the attachment bucket private and give only the runtime identity required object access.

Cloud Run returns an HTTPS service URL. No custom domain is needed. Set the LINE webhook to that URL plus `/api/line/webhook`.

Verify the revision without exposing environment values:

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

1. Register a LINE Business ID with a LINE account or email address. Create a LINE Official Account. Messaging API channels cannot be created directly in the Developers Console.
2. In LINE Official Account Manager, enable **Messaging API**. Select the provider carefully; LINE cannot move a channel to another provider later.
3. Open the channel in LINE Developers Console. Copy the channel secret from **Basic settings**. In **Messaging API**, issue a channel access token. The code accepts it as a bearer credential; the console-issued token is simplest for this smoke.
4. Store both values in Secret Manager with the standard-input commands. Never put them in chat, a tracked file, command argument, or screenshot.
5. Deploy the web application. Copy its Cloud Run HTTPS URL.
6. Set the webhook URL to `https://<cloud-run-host>/api/line/webhook`.
7. Enable **Use webhook** and **Webhook redelivery**. Use **Verify**. The signed empty-event request must return `200`.
8. For group testing, enable **Allow bot to join group chats**. DMs need no group setting.
9. Disable greeting and automatic replies in LINE Official Account Manager if LINE sends an additional automatic response. Regional interfaces can hide inactive controls.
10. Scan the QR code on the channel's **Messaging API** tab to add the Official Account as a friend.

The implementation uses LINE's documented `x-line-signature`, `webhookEventId`, `mention.mentionees[].isSelf`, and one-time `replyToken` behavior. See the official references in [`LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md`](./LINE_CONVERSATIONAL_PROTOTYPE_SPEC.md).

## Fictional live smoke

Prefer the automated fictional JSONL smoke. Do not require a real LINE user,
DM, or group unless the test must verify provider delivery behavior that the
signed in-process adapter cannot simulate. Use a manual LINE check only as a
narrow fallback, and document why automation is not sufficient.

Run the automated memory smoke against the target Firestore project with the
explicit write acknowledgement:

```bash
MEDBUDDY_RUN_CONTINUITY_TARGET_VERIFICATION=I_ACKNOWLEDGE_FICTIONAL_TARGET_WRITES \
MEDBUDDY_GCP_PROJECT_ID=med-buddy-503802 \
npm run verify:memory:target
```

The runner loads six bounded Traditional Chinese LINE events from JSONL. It
uses these production paths:

- signed LINE requests;
- the memory domain services;
- the target Firestore adapters.

It uses a fake reply transport. It tests these behaviors:

- the ten-minute passive trigger;
- same-workspace recall and explicit memory;
- source and trust attribution;
- MedBuddy source exclusion after a later formation cycle;
- decoy-workspace isolation;
- deterministic medication-change refusal before model use.

The runner checks for target collisions before the first write. It removes and
verifies the exact nonce-based workspace and receipt scope in a `finally` block.
It does not use a LINE channel secret or call the LINE API.

If the process stops before cleanup, it leaves a mode-`0600` manifest in the
system temporary directory. Run this command with the path from the failed run:

```bash
MEDBUDDY_RUN_CONTINUITY_TARGET_VERIFICATION=I_ACKNOWLEDGE_FICTIONAL_TARGET_WRITES \
MEDBUDDY_GCP_PROJECT_ID=med-buddy-503802 \
MEDBUDDY_CONTINUITY_CLEANUP_MANIFEST=/tmp/medbuddy-deployed-memory-smoke-<run-nonce>.json \
npm run verify:continuity:cleanup
```

If a provider-boundary check is necessary:

1. Confirm Secret Manager mappings and ADC-backed Vertex access in the deployed revision.
2. Use the LINE console **Verify** action. Confirm HTTP `200`.
3. Use only fictional content in a disposable DM or group.
4. Confirm logs contain `line_event_completed`, but no content, token, or LINE identifier.

Do not use real family data until privacy disclosure, retention, deletion, and a production log review are implemented and explicitly approved.

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

The repository records no LINE user, group, message, or channel identifier; credential; prompt; model output; or conversation content. The public service URL and non-secret deployment metadata above are enough to reproduce and diagnose the prototype.

The Compute Engine default service account had a pre-existing project-level `roles/editor` grant when the source-build role was added. The deployment did not change that broad legacy grant because its other consumers were unknown. Review and narrow it before real family data is approved.

The deployed smoke proves only the fictional text loop. It does not remove the gates for disclosure, consent, retention, deletion, dependency remediation, or production log review.

## Effort 3 deployed memory smoke record (2026-08-07)

The source-backed memory revision is deployed. The automated target smoke
replaced the planned human LINE group exercise:

| Item | Verified state |
| --- | --- |
| Cloud Run revision and traffic | `medbuddy-line-00012-hud`, 100% traffic after a tagged zero-traffic probe |
| Rollback target | `medbuddy-line-00011-tls` retained as the previous known-good revision |
| Model boundary | Conversation `gemini-3.6-flash`; compaction `gemini-3.5-flash-lite`; global Vertex endpoint and ADC runtime identity |
| HTTP boundary | Root and correctly signed empty LINE webhook returned `200`; unsigned memory-formation and passive-memory callbacks returned `401` |
| Firestore foundation | Seven composite indexes and the `memoryFormationOutbox.policyVersion` collection-group field index reached ready state; Terraform converged with no changes |
| Recovery automation | Production and verification-small OIDC jobs enabled every five minutes; both automatic attempts completed with status code `0` |
| Rendered-size policies | Production 30,000 UTF-16 units; verification-small 1,800 UTF-16 units |
| Dynamic-memory live evaluation | Traditional Chinese semantic, episodic, and allow-listed procedural scenarios passed against the configured Vertex model |
| Effort 1/2 regression evaluation | The first counterfactual family-map attempt declined the required sparse inference. An identical rerun passed all three assertions. This result matches the documented stochastic model variance. The failure did not occur in a compaction, persistence, or infrastructure assertion. |
| Automated fictional LINE memory observations | Six signed JSONL events passed against target Firestore: zero passive replies, two attributed recalls, one explicit acknowledgment, one medication refusal before model use, two primary memories, zero isolated-workspace memories, zero MedBuddy sources after later formation, two human canonical sources, and six content-free operational log entries |
| Synthetic cleanup | The exact two-workspace and six-receipt nonce scope was removed and verified; no recovery manifest remained |

The first infrastructure apply also exposed an invalid composite declaration for
the outbox policy lookup. Firestore correctly rejected it as unnecessary. The
configuration now uses a single-field collection-group index while preserving
the inherited collection-scope indexes; authenticated recovery succeeded only
after that index reached ready state.

No real conversation data was enabled. Repository evidence contains no LINE
identifier, credential, prompt, model output, or conversation content. The
recovery jobs and indexes are intentionally retained as the deployed prototype
foundation. The automated target smoke removed all of its fictional data.
