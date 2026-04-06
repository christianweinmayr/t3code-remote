import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox, NativeModules } from "react-native";

export default function RootLayout() {
  useEffect(() => {
    // Disable yellow box warnings bar
    LogBox.ignoreAllLogs(true);

    // Disable shake-to-show dev menu
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
          headerStyle: { backgroundColor: "#0a0a0a" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: "#0a0a0a" },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
