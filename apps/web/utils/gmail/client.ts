import { auth, gmail } from "@googleapis/gmail";
import { people } from "@googleapis/people";
import { saveRefreshToken } from "@/utils/auth";
import { env } from "@/env";

type ClientOptions = {
  accessToken?: string;
  refreshToken?: string;
};

const getClient = (session: ClientOptions) => {
  const googleAuth = new auth.OAuth2({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });
  // not passing refresh_token when next-auth handles it
  googleAuth.setCredentials({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });

  return googleAuth;
};

export const getGmailClient = (session: ClientOptions) => {
  const auth = getClient(session);
  const g = gmail({ version: "v1", auth });

  return g;
};

export const getContactsClient = (session: ClientOptions) => {
  const auth = getClient(session);
  const contacts = people({ version: "v1", auth });

  return contacts;
};

export const getGmailAccessToken = (session: ClientOptions) => {
  const auth = getClient(session);
  return auth.getAccessToken();
};

export const getGmailClientWithRefresh = async (
  session: ClientOptions & { refreshToken: string; expiryDate?: number | null },
  providerAccountId: string,
) => {
  const auth = getClient(session);
  const g = gmail({ version: "v1", auth });

  if (session.expiryDate && session.expiryDate > Date.now()) return g;

  const tokens = await auth.refreshAccessToken();

  if (tokens.credentials.access_token !== session.accessToken) {
    await saveRefreshToken(
      {
        access_token: tokens.credentials.access_token ?? undefined,
        expires_at: tokens.credentials.expiry_date
          ? Math.floor(tokens.credentials.expiry_date / 1000)
          : undefined,
      },
      {
        refresh_token: session.refreshToken,
        providerAccountId,
      },
    );
  }

  return gmail;
};
