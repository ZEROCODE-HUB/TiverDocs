import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { useToast } from "@/hooks/use-toast";

interface ForgotPasswordFormProps {
  onBack: () => void;
  onSubmit: (email: string, captchaToken: string) => void;
}

export const ForgotPasswordForm = ({ onBack, onSubmit }: ForgotPasswordFormProps) => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captcha = useRef<HCaptcha>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    if (!captchaToken) {
      toast({
        title: "Verificación requerida",
        description: "Por favor completa la verificación del CAPTCHA para continuar.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      await onSubmit(email, captchaToken);
      setIsSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <Card className="shadow-elevated border-0 bg-gradient-card">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="w-6 h-6 text-success" />
          </div>
          <CardTitle className="text-xl text-success">Enlace Enviado</CardTitle>
          <CardDescription>
            Hemos enviado un enlace de recuperación a <strong>{email}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Revisa tu bandeja de entrada y sigue las instrucciones del correo para restablecer tu contraseña.
            </p>
            <Button 
              onClick={onBack}
              variant="outline"
              className="w-full"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Volver al inicio de sesión
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-elevated border-0 bg-gradient-card">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Recuperar Contraseña</CardTitle>
        <CardDescription>
          Ingresa tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recovery-email" className="flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Correo electrónico
            </Label>
            <Input
              id="recovery-email"
              type="email"
              placeholder="tu@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-background/50"
            />
          </div>

          <div className="flex flex-col items-center gap-2 mt-4 min-h-[78px]">
            <HCaptcha
              ref={captcha}
              sitekey={
                import.meta.env.VITE_HCAPTCHA_SITE_KEY ||
                "10000000-ffff-ffff-ffff-000000000001"
              }
              onVerify={(token) => setCaptchaToken(token)}
              onExpire={() => setCaptchaToken(null)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={onBack}
              variant="outline"
              className="flex-1"
              disabled={isLoading}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Volver
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-gradient-primary hover:opacity-90 transition-opacity"
              disabled={isLoading || !email || !captchaToken}
            >
              {isLoading ? "Enviando..." : "Enviar Enlace"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};