/**
 * @format
 */

import { ClerkClient, ClerkError, frontendApiHost } from '../src/lib/clerk';

// Clerk's Frontend API in native mode, as the Windows app uses it. The request shapes here were checked against
// the real instance (a client request and a sign-in for an address that doesn't exist); the success responses
// follow Clerk's documented resources.

// Jest runs on Node; this project has no Node types.
declare const Buffer: {
  from(value: string): { toString(encoding: 'base64'): string };
};

type Call = { url: string; init: RequestInit };

function response(status: number, body: unknown, clientToken?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? clientToken ?? null : null,
    },
    json: async () => body,
  };
}

function base64url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/[=]+$/, '');
}

function sessionJwt(expSeconds: number): string {
  return `${base64url('{"alg":"RS256"}')}.${base64url(
    JSON.stringify({ sub: 'user_1', exp: expSeconds }),
  )}.signature`;
}

const client = {
  sessions: [
    {
      id: 'sess_1',
      status: 'active',
      user: {
        id: 'user_1',
        first_name: 'Ada',
        primary_email_address_id: 'idn_1',
        email_addresses: [{ id: 'idn_1', email_address: 'ada@example.com' }],
      },
    },
  ],
  last_active_session_id: 'sess_1',
};

let calls: Call[];
let replies: ReturnType<typeof response>[];

beforeEach(() => {
  calls = [];
  replies = [];
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) {
      throw new Error(`Unexpected request ${init.method} ${url}`);
    }
    return next;
  }) as unknown as typeof fetch;
});

test('reads the Frontend API host from a publishable key, as the backend does', () => {
  expect(
    frontendApiHost(
      'pk_test_Y2FzdWFsLXJhYmJpdC03MjY4LmNsZXJrLmFjY291bnRzLmRldiQ',
    ),
  ).toBe('casual-rabbit-7268.clerk.accounts.dev');
  expect(() => frontendApiHost('sk_test_abc')).toThrow(ClerkError);
});

test('email and password sign-in, then cached session tokens', async () => {
  const clerk = new ClerkClient('example.clerk.accounts.dev');
  const exp = Math.floor(Date.now() / 1000) + 60;
  replies = [
    response(
      200,
      {
        response: {
          id: 'sia_1',
          status: 'complete',
          created_session_id: 'sess_1',
        },
        client,
      },
      'client-token-1',
    ),
    response(200, { response: client }),
    response(200, { object: 'token', jwt: sessionJwt(exp) }),
  ];

  await expect(
    clerk.signInWithPassword('ada@example.com', 'correct horse'),
  ).resolves.toEqual({ step: 'complete' });
  expect(calls[0].url).toBe(
    'https://example.clerk.accounts.dev/v1/client/sign_ins?_is_native=1',
  );
  expect(calls[0].init.method).toBe('POST');
  expect(calls[0].init.body).toBe(
    'identifier=ada%40example.com&password=correct%20horse&strategy=password',
  );
  // The client token from the first response identifies this client from then on.
  expect((calls[1].init.headers as Record<string, string>).Authorization).toBe(
    'client-token-1',
  );
  expect(clerk.currentUser).toEqual({
    id: 'user_1',
    email: 'ada@example.com',
    firstName: 'Ada',
  });

  const token = await clerk.getToken();
  expect(token).toBe(sessionJwt(exp));
  expect(calls[2].url).toBe(
    'https://example.clerk.accounts.dev/v1/client/sessions/sess_1/tokens?_is_native=1',
  );
  // Still valid: no new request. skipCache asks again (the API client does that after a 401).
  await clerk.getToken();
  expect(calls).toHaveLength(3);
  replies = [response(200, { jwt: sessionJwt(exp + 60) })];
  await expect(clerk.getToken({ skipCache: true })).resolves.toBe(
    sessionJwt(exp + 60),
  );

  // A new app session finds the saved client token and restores the session.
  const again = new ClerkClient('example.clerk.accounts.dev');
  replies = [response(200, { response: client })];
  await expect(again.restore()).resolves.toBe(true);
  expect(
    (calls[calls.length - 1].init.headers as Record<string, string>)
      .Authorization,
  ).toBe('client-token-1');
});

test('a new-device check asks for the emailed code, as on iPhone', async () => {
  const clerk = new ClerkClient('example.clerk.accounts.dev');
  replies = [
    response(200, {
      response: {
        id: 'sia_2',
        status: 'needs_client_trust',
        created_session_id: null,
        supported_second_factors: [
          {
            strategy: 'email_code',
            email_address_id: 'idn_1',
            safe_identifier: 'a***@example.com',
          },
        ],
      },
    }),
    response(200, { response: { id: 'sia_2', status: 'needs_client_trust' } }),
  ];
  await expect(
    clerk.signInWithPassword('ada@example.com', 'pw'),
  ).resolves.toEqual({ step: 'code', sentTo: 'a***@example.com' });
  expect(calls[1].url).toContain(
    '/client/sign_ins/sia_2/prepare_second_factor',
  );
  expect(calls[1].init.body).toBe('strategy=email_code&email_address_id=idn_1');

  replies = [
    response(200, {
      response: {
        id: 'sia_2',
        status: 'complete',
        created_session_id: 'sess_1',
      },
    }),
    response(200, { response: client }),
  ];
  await expect(clerk.verifyEmailCode('123456')).resolves.toEqual({
    step: 'complete',
  });
  expect(calls[2].url).toContain(
    '/client/sign_ins/sia_2/attempt_second_factor',
  );
  expect(calls[2].init.body).toBe('strategy=email_code&code=123456');
  expect(clerk.signedIn).toBe(true);
});

test('Clerk errors come back with their message', async () => {
  const clerk = new ClerkClient('example.clerk.accounts.dev');
  replies = [
    response(422, {
      errors: [
        {
          message: "Couldn't find your account.",
          long_message: "Couldn't find your account.",
          code: 'form_identifier_not_found',
        },
      ],
    }),
  ];
  await expect(
    clerk.signInWithPassword('nobody@example.com', 'pw'),
  ).rejects.toMatchObject({
    message: "Couldn't find your account.",
    code: 'form_identifier_not_found',
  });
});
