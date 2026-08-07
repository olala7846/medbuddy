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
MEDBUDDY_COMPACTION_VERTEX_MODEL=gemini-3.5-flash-lite
```

`gemini-3.6-flash` remains the conversation and tool-use model.
`gemini-3.5-flash-lite` handles only the bounded, one-call, structured
compaction summary. Both must pass configuration-gated fictional smoke tests in
the target project and region before live-model verification is claimed.

The private continuity runtime also requires:

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

`MEDBUDDY_CONTINUITY_PROFILE` defaults to `production`. For a fictional-only,
temporary compaction exercise, set it to `verification-small`; this uses a
600-unit protected recent window, a 1,200-unit compaction trigger, and a
1,800-unit pending hard ceiling. The verification profile has a distinct
policy version, so its jobs and segments are not reused as production history.
Restore `production` after the exercise.

The profile is selected as one whole pair. `production` binds
`continuity-v1` to `memory-formation-v1` with a 30,000 rendered UTF-16
formation ceiling. `verification-small` binds their verification-small
counterparts with a 1,800-unit ceiling. Individual formation thresholds are
not environment overrides. The formation callback accepts only bounded,
OIDC-authenticated wake or recovery requests and never accepts message content.

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
conversation and compaction model smokes succeed in the target project and
region.

## Optional Effort 2 exact tracing (default off)

LangSmith tracing exists only to inspect the exact structured Vertex request
and parsed response for fictional conversation and compaction verification. It
does not trace the full LINE webhook, text capture, image extraction, attachment
ingestion, Google authentication, headers, or access tokens.

Tracing remains disabled unless every value below is present and the enable
flag is exactly `true`:

```text
MEDBUDDY_LANGSMITH_TRACING_ENABLED=true
MEDBUDDY_LANGSMITH_SERVICE_KEY=<dedicated Secret Manager mapping>
MEDBUDDY_LANGSMITH_PROJECT=<dedicated Effort 2 tracing project>
MEDBUDDY_LANGSMITH_WORKSPACE_ID=<LangSmith workspace ID>
MEDBUDDY_LANGSMITH_API_URL=<approved regional LangSmith API URL>
MEDBUDDY_LANGSMITH_ALLOWED_WORKSPACE_ID=<one fictional internal workspace ID>
MEDBUDDY_LANGSMITH_VERIFICATION_ID=<content-free verification label>
```

Only the US GCP, EU GCP, APAC GCP, and AWS US LangSmith SaaS API URLs are
accepted. Generic `LANGSMITH_*` environment variables do not enable this
integration. The MedBuddy workspace allowlist is evaluated locally and is
never sent as trace metadata. A missing scope, a different workspace, or any
Vertex request containing inline image data proceeds without tracing.

Before enabling, create a dedicated LangSmith project with base 14-day trace
retention and a short-lived workspace-scoped service key. Map that key from a
pinned Secret Manager version; never place it in source, `.env`, a command
argument, chat, logs, or screenshots. Do not add traced runs to datasets,
experiments, annotation queues, feedback, evaluators, or automation rules,
because those features can retain or upgrade trace data beyond the base tier.
Exact-content tracing is not approved for real family traffic.

For rollback, first deploy with tracing disabled and remove the Cloud Run
secret mapping, then revoke the service key. After verification is complete,
delete the dedicated LangSmith project and query it later to confirm the
provider's asynchronous deletion. Some billing or analytics metadata may
persist according to LangSmith policy.

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
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
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

gcloud secrets create medbuddy-attachment-locator-key \
  --replication-policy=automatic \
  --project=med-buddy-503802
gcloud secrets versions add medbuddy-attachment-locator-key \
  --data-file=- \
  --project=med-buddy-503802
```

The attachment locator value entered above must be canonical base64 for exactly
32 random bytes. Grant the runtime identity access only to the three runtime
secrets:

```bash
for secret_name in medbuddy-line-channel-secret medbuddy-line-channel-access-token medbuddy-attachment-locator-key; do
  gcloud secrets add-iam-policy-binding "${secret_name}" \
    --project=med-buddy-503802 \
    --member=serviceAccount:medbuddy-runtime@med-buddy-503802.iam.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor
done
```

From the repository root, deploy the source with a scale-to-zero, low-cost
prototype ceiling only after the configuration-gated conversation and
compaction model smokes pass. Secret versions are pinned rather than resolved from `latest` at
runtime. Fill in the non-secret queue, callback, service-account, and private
bucket values; set the two version variables to the enabled Secret Manager
versions. The locator key itself remains a secret mapping and never appears in
the command:

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

The task caller must have permission to enqueue on the named private queue and
invoke the Cloud Run service with OIDC. The callback code additionally requires
the token audience to equal each configured callback URL and the token email to
equal `MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL`. Keep the attachment bucket private
and grant only the runtime identity the required object access.

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

The runner loads five bounded Traditional Chinese LINE events from JSONL. It
uses signed LINE requests, a fake reply transport, the production memory domain
services, and the target Firestore adapters. It tests the ten-minute passive
trigger, same-workspace recall, explicit remember, source and trust attribution,
MedBuddy source exclusion, and a decoy workspace. It checks for target-scope
collisions before the first write. It removes and verifies its exact nonce-based
workspace and receipt scope in a `finally` block. It does not use a LINE channel
secret or call the LINE API.

If the process stops before cleanup, it leaves a mode-`0600` manifest in the
system temporary directory. Use `npm run verify:continuity:cleanup` with the
manifest path and the same target acknowledgement.

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
| Automated fictional LINE memory observations | Five signed JSONL events passed against target Firestore: zero passive replies, two attributed recalls, one explicit acknowledgment, two primary memories, zero isolated-workspace memories, two human canonical sources, and five content-free operational log entries |
| Synthetic cleanup | The exact two-workspace and five-receipt nonce scope was removed and verified; no recovery manifest remained |

The first infrastructure apply also exposed an invalid composite declaration for
the outbox policy lookup. Firestore correctly rejected it as unnecessary. The
configuration now uses a single-field collection-group index while preserving
the inherited collection-scope indexes; authenticated recovery succeeded only
after that index reached ready state.

No real conversation data was enabled. Repository evidence contains no LINE
identifier, credential, prompt, model output, or conversation content. The
recovery jobs and indexes are intentionally retained as the deployed prototype
foundation. The automated target smoke removed all of its fictional data.
