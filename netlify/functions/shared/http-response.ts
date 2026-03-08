export const jsonResponse = (statusCode: number, body: Record<string, boolean | number | string>): Response =>
  new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  })
