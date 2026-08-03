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
| GCP project ID | GCP project hosting Firestore, Vertex, and Cloud Run | `MEDBUDDY_GCP_PROJECT_ID`, `MEDBUDDY_VERTEX_PROJECT` |

Vertex authentication uses Application Default Credentials; do not create or commit a service-account key file. The deployed runtime identity needs the minimum Firestore and Vertex permissions required to store thread messages/receipts and invoke the configured model.

Optional Vertex settings are:

```text
MEDBUDDY_VERTEX_ENABLED=true
MEDBUDDY_VERTEX_LOCATION=global
MEDBUDDY_VERTEX_MODEL=gemini-3.6-flash
```

Use Secret Manager-backed environment variables in Cloud Run. To avoid putting secret values in shell history, create the secret containers and add values interactively through standard input:

```bash
gcloud secrets create medbuddy-line-channel-secret --replication-policy=automatic
gcloud secrets versions add medbuddy-line-channel-secret --data-file=-
gcloud secrets create medbuddy-line-channel-access-token --replication-policy=automatic
gcloud secrets versions add medbuddy-line-channel-access-token --data-file=-
```

Grant the Cloud Run runtime identity access only to those secrets, then map them to the two `MEDBUDDY_LINE_*` environment variables during deployment.

## LINE Developers Console

1. Create or select a provider and create a Messaging API channel.
2. Record the channel secret and issue a channel access token using the secret mechanism above.
3. Deploy the web application to a public HTTPS origin.
4. Set the webhook URL to `https://<public-host>/api/line/webhook`.
5. Enable **Use webhook** and **Webhook redelivery**, then use **Verify**. The signed empty-event verification request should return `200`.
6. For group testing, enable **Allow bot to join group chats**. DMs need no group setting.
7. In LINE Official Account Manager response settings, disable greeting or automatic replies that would create a second response beside the webhook agent.

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
