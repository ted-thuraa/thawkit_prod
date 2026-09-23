import { authClient } from "../lib/auth/auth-client";

export const useCurrentSession = () => {
  const session = authClient.useSession();

  return session;
};
