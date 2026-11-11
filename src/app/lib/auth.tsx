/**
 * React context — AuthController (domain)-ийг дэлгэцүүдэд хүргэнэ.
 * Нэвтрэлтийн логик бүхэлдээ AuthController-т; энд зөвхөн React state.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AuthController, type User } from "../domain";

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { email: string; password: string; name: string; phone?: string; consent: boolean }) => Promise<User>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);
const authController = new AuthController();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    authController.getUser().then(setUser).finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await authController.login(email, password);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (data: { email: string; password: string; name: string; phone?: string; consent: boolean }) => {
    const u = await authController.register(data);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    authController.logout();
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, ready, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("AuthProvider алга");
  return c;
}
