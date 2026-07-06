import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Lock, Mail, ShieldCheck, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import officeBackground from "@/assets/office-background.jpg";
import tiverLogo from "@/assets/tiver-logo.png";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { RegisterRequestForm } from "./RegisterRequestForm";
import { TOTPEnrollmentForm } from "./TOTPEnrollmentForm";
import { TOTPVerificationForm } from "./TOTPVerificationForm";
import { createRegisterRequest } from "@/services/registerRequestService";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { getTOTPFactors, hasMFAEnabled } from "@/services/totpService";
import { useAuth } from "@/contexts/AuthContext";
//import { AltchaWidget } from "./AltchaWidget";
import HCaptcha from "@hcaptcha/react-hcaptcha";

/** Req 15: Configurar VITE_ALTCHA_CHALLENGE_URL en .env si se requiere PoW backend */
const ALTCHA_CHALLENGE_URL =
  import.meta.env.VITE_ALTCHA_CHALLENGE_URL || undefined;

interface LoginFormProps {
  onLogin: (email: string, password: string) => void;
  onForgotPassword: () => void;
}

type ViewState =
  | "login"
  | "forgot-password"
  | "register-request"
  | "totp-verify"
  | "totp-enroll"
  | "totp-optional";

export const LoginForm = ({ onLogin, onForgotPassword }: LoginFormProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>("login");
  const { toast } = useToast();

  //const [captchaVerified, setCaptchaVerified] = useState(false);

  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captcha = useRef<HCaptcha>(null);

  const { setMfaPending } = useAuth();

  // TOTP states
  const [totpFactorId, setTotpFactorId] = useState<string | null>(null);
  const [pendingCredentials, setPendingCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const tempSessionRef = useRef<any>(null);

  // Rate Limiting States
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutTimer, setLockoutTimer] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (lockoutTimer > 0) {
      interval = setInterval(() => {
        setLockoutTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [lockoutTimer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lockoutTimer > 0) return;

    // Req 15: Verificar CAPTCHA con ALTCHA
    if (!captchaToken) {
      toast({
        title: "Verificación requerida",
        description:
          "Por favor completa la verificación del CAPTCHA para continuar.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    // Bloquear AuthContext para que no nos redirija al dashboard antes de verificar TOTP
    setMfaPending(true);
    try {
      console.log("[LoginForm]");

      // Paso 1: Login normal (email + password)
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: {
          captchaToken,
        },
      });

      if (error) {
        console.error("[LoginFormE]");

        setFailedAttempts((prev) => {
          const newAttempts = prev + 1;
          if (newAttempts >= 3) {
            setLockoutTimer(30);
            toast({
              title: "Múltiples intentos fallidos",
              description: "Demasiados intentos. Por favor espera 30 segundos.",
              variant: "destructive",
            });
            return 0;
          } else {
            toast({
              title: "Error de autenticación",
              description: error.message || "Email o contraseña incorrectos",
              variant: "destructive",
            });
          }
          return newAttempts;
        });

        setIsLoading(false);
        setMfaPending(false); // Resetear si el login falla
        return;
      }

      if (!data.user || !data.session) {
        throw new Error("No se recibió sesión del servidor");
      }

      console.log("[LoginForm] Kredenciales validadas");

      // Guardar sesión temporal (hasta verificar TOTP)
      tempSessionRef.current = data.session;
      setPendingCredentials({ email, password });

      // Paso 2: Verificar que usuario tenga TOTP configurado
      try {
        const totpFactors = await getTOTPFactors();

        if (!totpFactors || totpFactors.length === 0) {
          console.warn(
            "[LoginForm] Usuario NO tiene TOTP configurado - Redirigiendo a enrolamiento",
          );
          toast({
            title: "Configuración requerida",
            description:
              "Para proteger tu cuenta, debes configurar la autenticación de 2 factores (TOTP).",
          });

          // No cerramos sesión porque la necesitamos para enrolar el factor
          setCurrentView("totp-enroll");
          setIsLoading(false);
          return;
        }

        // Buscar factor TOTP verificado
        const verifiedFactor = totpFactors.find((f) => f.status === "verified");
        if (!verifiedFactor) {
          console.warn(
            "[LoginForm] Usuario tiene TOTP pero no está verificado - Redirigiendo a enrolamiento",
          );
          toast({
            title: "Configuración pendiente",
            description:
              "Tu autenticación de 2 factores no está completada. Por favor, realiza el proceso de configuración.",
          });

          // Redirigir a enrolamiento para que el usuario pueda completar el proceso
          setCurrentView("totp-enroll");
          setIsLoading(false);
          return;
        }

        console.log("[LoginForm] Usuario tiene TOTP verificado");

        // Mostrar formulario de verificación TOTP
        setTotpFactorId(verifiedFactor.id);
        setCurrentView("totp-verify");
        console.log("[LoginForm] Mostrando formulario verificación TOTP");
      } catch (err: any) {
        console.error("[LoginForm] Error verificando TOTP:", err);
        await supabase.auth.signOut();
        setMfaPending(false); // Resetear si falla la verificación de factores
        toast({
          title: "Error",
          description:
            err.message || "No se pudo verificar la configuración de 2FA",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("[LoginForm] Error inesperado en login:", error);
      toast({
        title: "Error",
        description: error.message || "Error al iniciar sesión",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (email: string, captchaToken: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
        captchaToken,
      });

      if (error) throw error;

      toast({
        title: "Enlace enviado",
        description: "Revisa tu correo para restablecer tu contraseña.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.message || "No se pudo enviar el enlace de recuperación.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleRegisterRequest = async (data: {
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    message: string;
  }) => {
    try {
      await createRegisterRequest({
        company_name: data.companyName,
        contact_name: data.contactName,
        email: data.email,
        phone: data.phone,
        message: data.message,
      });

      toast({
        title: "Solicitud enviada",
        description: "Hemos recibido tu solicitud. Te contactaremos pronto.",
      });
    } catch (error) {
      console.error("Error al enviar solicitud:", error);
      toast({
        title: "Error",
        description: "No se pudo enviar la solicitud. Inténtalo de nuevo.",
        variant: "destructive",
      });
      throw error;
    }
  };

  /**
   * Se llama cuando TOTP es verificado exitosamente
   * Completa el login del usuario
   */
  const handleTOTPVerificationComplete = async (session: any, user: any) => {
    try {
      console.log(
        "[LoginForm] TOTP verificado - Completando login para:",
        user.email,
      );

      // Liberar AuthContext para que pueda ver la nueva sesión AAL2 que vamos a restaurar
      setMfaPending(false);

      // Restaurar sesión en Supabase
      if (session && session.access_token && session.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });

        if (error) throw error;

        console.log("[LoginForm] Sesión restaurada exitosamente");

        toast({
          title: "¡Acceso concedido!",
          description: "Verificación de 2 factores completada.",
        });
      }

      // Limpiar estados
      setTotpFactorId(null);
      setPendingCredentials(null);
      tempSessionRef.current = null;

      // Reiniciar UI
      setCurrentView("login");
      setEmail("");
      setPassword("");
    } catch (error: any) {
      console.error("[LoginForm] Error al completar login TOTP:", error);
      toast({
        title: "Error",
        description: error.message || "Error al completar el acceso",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  /**
   * Se llama cuando el usuario rechaza/cancela enrollarse en TOTP
   * Ya que es obligatorio, de no hacerlo cancelamos el login por completo
   */
  const handleTOTPEnrollmentSkip = async () => {
    try {
      setCurrentView("login");
      setTotpFactorId(null);
      setPendingCredentials(null);
      tempSessionRef.current = null;
      setMfaPending(false);

      // Desmontar sesión temporal creada en caso de cancelación
      await supabase.auth.signOut();
    } catch (error: any) {
      console.error("Error al cancelar TOTP:", error);
      toast({
        title: "Error",
        description: error.message || "Error al completar el login",
        variant: "destructive",
      });
    }
  };

  const handleTOTPEnrollmentComplete = async () => {
    try {
      toast({
        title: "¡Éxito!",
        description: "Tu Autenticador de Dos Factores ha sido configurado.",
      });

      // La sesión de Supabase ya se actualizó a AAL2 internamente.
      // Liberamos el contexto de AuthContext para que lo procese y nos dirija al dashboard.
      setMfaPending(false);
    } catch (error: any) {
      console.error("Error al completar enrollamiento:", error);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Background image with overlay (desktop only) */}
      <div
        className="hidden lg:flex lg:flex-1 relative bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${officeBackground})` }}
      >
        <div className="absolute inset-0 bg-primary/25"></div>
      </div>

      {/* Right side - Login form */}
      <div className="flex-1 lg:flex-1 bg-gradient-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-primary rounded-2xl mb-4 shadow-elevated">
              <img
                src={tiverLogo}
                alt="TIVER Logo"
                className="w-auto h-auto max-w-16 max-h-16 object-contain"
              />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              TiverDocs
            </h1>
            <p className="text-muted-foreground mt-2">
              Repositorio Seguro de Títulos Valor
            </p>
          </div>

          {currentView === "login" && (
            <>
              <Card className="shadow-elevated border-0 bg-gradient-card">
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl">Iniciar Sesión</CardTitle>
                  <CardDescription>
                    Accede a tu repositorio de documentos firmados
                    electrónicamente
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="email"
                        className="flex items-center gap-2"
                      >
                        <Mail className="w-4 h-4" />
                        Correo electrónico
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="tu@empresa.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={isLoading || lockoutTimer > 0}
                        className="bg-background/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="password"
                        className="flex items-center gap-2"
                      >
                        <Lock className="w-4 h-4" />
                        Contraseña
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={isLoading || lockoutTimer > 0}
                        className="bg-background/50"
                      />
                    </div>

                    {lockoutTimer > 0 && (
                      <Alert variant="destructive">
                        <AlertTriangle className="w-4 h-4" />
                        <AlertDescription>
                          Demasiados intentos. Intenta de nuevo en{" "}
                          {lockoutTimer}s.
                        </AlertDescription>
                      </Alert>
                    )}

                    {failedAttempts > 0 && lockoutTimer === 0 && (
                      <Alert className="bg-amber-50 border-amber-200">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <AlertDescription className="text-amber-900 text-sm">
                          {failedAttempts}{" "}
                          {failedAttempts === 1
                            ? "intento fallido"
                            : "intentos fallidos"}
                          . A los 3 intentos se bloqueará temporalmente.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Req 15: Widget hCaptcha integrado */}
                    <div className="flex flex-col items-center gap-2 mt-4 min-h-[78px]">
                      <HCaptcha
                        ref={captcha}
                        sitekey={
                          import.meta.env.VITE_HCAPTCHA_SITE_KEY ||
                          "10000000-ffff-ffff-ffff-000000000001"
                        }
                        onVerify={(token) => {
                          setCaptchaToken(token);
                        }}
                        onExpire={() => setCaptchaToken(null)}
                        onError={(err) => {
                          console.error("[LoginForm] hCaptcha Error:", err);
                        }}
                      />
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-gradient-primary hover:opacity-90 transition-opacity"
                      disabled={isLoading || !captchaToken || lockoutTimer > 0}
                    >
                      {isLoading ? "Iniciando sesión..." : "Iniciar Sesión"}
                    </Button>
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => setCurrentView("forgot-password")}
                        className="text-primary hover:text-primary/80 text-sm transition-colors"
                      >
                        ¿Olvidaste tu contraseña?
                      </button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <div className="text-center mt-6 text-sm text-muted-foreground">
                ¿Eres una nueva empresa?{" "}
                <button
                  onClick={() => setCurrentView("register-request")}
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  Solicita acceso
                </button>
              </div>
            </>
          )}

          {currentView === "forgot-password" && (
            <ForgotPasswordForm
              onBack={() => setCurrentView("login")}
              onSubmit={handleForgotPassword}
            />
          )}

          {currentView === "register-request" && (
            <RegisterRequestForm
              onBack={() => setCurrentView("login")}
              onSubmit={handleRegisterRequest}
            />
          )}

          {/* TOTP Verification - Cuando el usuario tiene TOTP configurado */}
          {currentView === "totp-verify" &&
            totpFactorId &&
            pendingCredentials && (
              <TOTPVerificationForm
                factorId={totpFactorId}
                email={pendingCredentials.email}
                onVerificationComplete={handleTOTPVerificationComplete}
                onCancel={() => {
                  setCurrentView("login");
                  setTotpFactorId(null);
                  setPendingCredentials(null);
                  setEmail("");
                  setPassword("");
                  setMfaPending(false); // Resetear al cancelar
                }}
              />
            )}

          {/* TOTP Enrollment - Permitir al usuario registrarse en TOTP */}
          {currentView === "totp-enroll" && (
            <TOTPEnrollmentForm
              onEnrollmentComplete={handleTOTPEnrollmentComplete}
              onCancel={() => {
                setCurrentView("login");
                setEmail("");
                setPassword("");
                setMfaPending(false); // Resetear al cancelar
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
