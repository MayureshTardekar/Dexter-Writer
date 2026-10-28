// Tiny keep-alive endpoint. Called by pg_cron / cron-job.org so the free
// Supabase project does not pause after seven days of inactivity.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  return Response.json(
    {
      ok: true,
      service: 'dexter-write',
      ts: new Date().toISOString(),
    },
    { headers: cors },
  );
});
