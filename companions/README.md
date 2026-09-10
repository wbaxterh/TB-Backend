# Companion configuration

Add one JSON file per companion. Each file must provide an `id`, `displayName`,
`intro`, `messageExamples`, `voice`, `identityNotes`, `knows`, `toolGuidance`,
`dont`, `laugh`, and `vibe`. Optional fields include `botId`, `model`, and
`stageDemo`.

Set the matching bot user's `botCharacter` field to the configuration `id`.
Registered companions use the shared TrickBook tools, Atlas RAG, graph, and
per-bot relationship memory while keeping separate persona prompts and chat
history. Unregistered bot characters continue through the legacy Eliza path.
