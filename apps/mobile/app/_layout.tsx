import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox, NativeModules } from "react-native";

export default function RootLayout() {
  useEffect(() => {
    LogBox.ignoreAllLogs(true);
    if (__DEV__) {
      const DevSettings = NativeModules.DevSettings;
      if (DevSettings?.setIsShakeToShowDevMenuEnabled) {
        DevSettings.setIsShakeToShowDevMenuEnabled(false);
      }
    }
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#000" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "600", fontSize: 17 },
          contentStyle: { backgroundColor: "#000" },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
