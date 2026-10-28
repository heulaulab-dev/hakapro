// Container-only diagnostic: fixed SQL, no HTTP surface, no credentials in output.
import postgres from "postgres";

export async function verifyIssuers(url: string) {
  const db = postgres(url, { max: 1, connect_timeout: 5, prepare: false, onnotice: () => {} });
  try {
    return await db.begin("read only", async (tx) => {
      await tx`set local statement_timeout = '5s'`;
      const counts = await tx`select source, count(*)::int records, count(distinct symbol)::int symbols, min(as_of) oldest, max(as_of) newest from idx_issuer_profiles group by source`;
      const duplicates = await tx`select symbol, language, count(*) from idx_issuer_profiles group by symbol, language having count(*) > 1`;
      const bbca = await tx`select symbol, language, source, as_of, retrieved_at, profile, shareholders, directors, commissioners from idx_issuer_profiles where symbol = 'BBCA'`;
      const history = await tx`select job_id, status, started_at, finished_at, rows_ingested from fetch_runs where job_id = 'idx-bei-issuer-import' order by started_at desc limit 10`;
      return { counts, duplicates, bbca, history };
    });
  } finally {
    await db.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  try {
    if (!process.env.ENGINE_DATABASE_URL) throw new Error("missing configuration");
    console.log(JSON.stringify(await verifyIssuers(process.env.ENGINE_DATABASE_URL)));
  } catch {
    console.error("Issuer verification failed; check database availability and schema.");
    process.exitCode = 1;
  }
}
