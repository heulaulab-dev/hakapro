# KSEI ownership import

BEI publishes the KSEI-provided monthly register **Pemegang Saham di Atas 1%** on its listed-company ownership page. The Engine keeps this dataset separate from IDX-BEI issuer disclosures and stores it through the existing authenticated ownership-upload path.

Run the fixed-source importer from the Engine container (or a Coolify scheduled task):

```sh
KSEI_ENGINE_URL=http://127.0.0.1:8080 \
ENGINE_ADMIN_TOKEN="$ENGINE_ADMIN_TOKEN" \
bun run scripts/import-ksei-ownership.ts
```

The task reads the signed release index from the pinned `fzn0x/idx` `ownership-data` release, verifies the IDX source URL, file size, and SHA-256, then uploads the newest XLSX with its snapshot date and provenance. Re-running the same month is safe because the Engine's SHA-256 dedupe returns `duplicate`.

The mirror is only a transport fallback for IDX's Cloudflare-protected files; the index records the original IDX URL. Do not replace this with arbitrary URL forwarding or the unauthenticated IDX-BEI SQL/trigger endpoints.
