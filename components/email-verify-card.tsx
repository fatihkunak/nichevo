import { useState } from "react";
import { Text, View } from "react-native";

import { Field } from "@/components/field";
import { Card, GradientButton } from "@/components/nv";
import { useSession } from "@/lib/session";

/** E-posta doğrulaması (yumuşak: hiçbir şeyi engellemez). Yalnızca sunucuda SMTP açıkken ve e-posta doğrulanmamışken görünür. */
export function EmailVerifyCard() {
  const { profile, mode, emailAvailable, verifyEmail, resendVerification } = useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  if (mode !== "server" || !emailAvailable || !profile || profile.emailVerified) return null;

  const send = async () => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await resendVerification();
      setNote(`${profile.email} adresine 6 haneli kod gönderdik. Kod 15 dakika geçerlidir.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError("Kod 6 haneli olmalı.");
    setBusy(true);
    setError("");
    try {
      await verifyEmail(code.trim());
      setCode("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="E-postanı doğrula" hint="isteğe bağlı">
      <Text className="text-muted text-[12px] mb-2">
        E-postan doğrulanmadı. Doğrulamak, şifreni unutursan hesabını kurtarabilmen için gereklidir.
      </Text>
      <Field
        label="E-postadaki 6 haneli kod"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        placeholder="123456"
        maxLength={6}
      />
      {note ? <Text className="text-muted text-[11px] mb-2">{note}</Text> : null}
      {error ? <Text className="text-error text-[12px] mb-2">{error}</Text> : null}
      <View className="flex-row">
        <GradientButton title="Doğrula" small onPress={confirm} loading={busy} disabled={code.length !== 6} style={{ marginRight: 8 }} />
        <GradientButton title="Kodu gönder" small onPress={send} loading={busy} />
      </View>
    </Card>
  );
}
