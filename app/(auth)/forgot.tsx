import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { Field, isEmail } from "@/components/field";
import { GradientButton, Logo } from "@/components/nv";
import { ScreenContainer } from "@/components/screen-container";
import { useSession } from "@/lib/session";

/** Şifremi unuttum: 1) e-posta → kod gönder, 2) kod + yeni şifre → şifre değişir ve oturum açılır. */
export default function ForgotScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { requestPasswordReset, resetPassword, emailAvailable } = useSession();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    if (!isEmail(email)) return setError("Geçerli bir e-posta girin.");
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setStep("code");
      setInfo("Bu e-posta kayıtlıysa 6 haneli bir kod gönderdik. Kod 15 dakika geçerlidir.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError("Kod 6 haneli olmalı.");
    if (password.length < 8) return setError("Yeni şifre en az 8 karakter olmalı.");
    setError("");
    setBusy(true);
    try {
      await resetPassword(email.trim().toLowerCase(), code.trim(), password);
      // Oturum açıldı; kök yerleşim kullanıcıyı ana ekrana yönlendirir
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer className="px-6">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <View className="items-center mb-6">
            <Logo size={88} />
          </View>
          <Text className="text-foreground text-xl font-bold mb-1">Şifreni sıfırla</Text>
          {!emailAvailable ? (
            <Text className="text-warning text-[12px] mb-3">Bu sunucuda e-posta gönderimi kapalı; şifre sıfırlama kullanılamıyor.</Text>
          ) : null}
          <Field
            label="E-posta"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="ornek@mail.com"
            editable={step === "email"}
          />
          {step === "code" ? (
            <>
              <Field
                label="E-postadaki 6 haneli kod"
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                placeholder="123456"
                maxLength={6}
              />
              <Field label="Yeni şifre (en az 8 karakter)" value={password} onChangeText={setPassword} secure placeholder="••••••••" />
            </>
          ) : null}
          {info ? <Text className="text-muted text-[12px] mb-2">{info}</Text> : null}
          {error ? <Text className="text-error text-[12px] mb-2">{error}</Text> : null}
          {step === "email" ? (
            <GradientButton title="Kodu gönder" onPress={sendCode} loading={busy} disabled={!emailAvailable} style={{ marginTop: 6 }} />
          ) : (
            <>
              <GradientButton title="Şifreyi sıfırla" onPress={submit} loading={busy} style={{ marginTop: 6 }} />
              <Pressable onPress={sendCode} disabled={busy} style={{ alignItems: "center", marginTop: 14 }} accessibilityLabel="Kodu tekrar gönder">
                <Text className="text-info text-[13px]">Kodu tekrar gönder</Text>
              </Pressable>
            </>
          )}
          <Pressable onPress={() => router.back()} style={{ alignItems: "center", marginTop: 18 }} accessibilityLabel="Girişe dön">
            <Text className="text-muted text-[13px]">‹ Girişe dön</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
