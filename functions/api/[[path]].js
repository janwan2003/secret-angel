// Forwards every API call to the AngelDB Durable Object (worker/), which holds all data.
export async function onRequest({ request, env }) {
  const stub = env.ANGEL.get(env.ANGEL.idFromName('main'));
  return stub.fetch(request);
}
