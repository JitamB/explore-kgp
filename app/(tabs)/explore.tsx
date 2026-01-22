// app/(tabs)/explore.tsx

import * as Location from "expo-location"
import * as SQLite from "expo-sqlite"
import React, { useEffect, useRef, useState } from "react"
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { WebView } from "react-native-webview"

type Coordinate = { latitude: number; longitude: number }

// Open database synchronously (Singleton)
const db = SQLite.openDatabaseSync("exploration.db");

export default function ExploreScreen() {
  const webviewRef = useRef<WebView>(null)
  const [isMapReady, setIsMapReady] = useState(false)
  const [location, setLocation] = useState<Coordinate | null>(null)
  const [explored, setExplored] = useState<Coordinate[]>([])
  const [isTracking, setIsTracking] = useState(false)
  const [watcher, setWatcher] = useState<Location.LocationSubscription | null>(null)

  useEffect(() => {
    async function initDB() {
      try {
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS explored_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL,
            longitude REAL,
            timestamp INTEGER
          );
        `);

        const result = await db.getAllAsync("SELECT latitude, longitude FROM explored_points") as Coordinate[];
        setExplored(result);
      } catch (e) {
        console.log("DB Init Error:", e);
      }
    }
    initDB();
  }, [])

  // Push updates to Web
  useEffect(() => {
    if (isMapReady && webviewRef.current && (location || explored.length > 0)) {
      const data = {
        type: 'update',
        location: location,
        points: explored,
        shouldCenter: isTracking
      }
      webviewRef.current.postMessage(JSON.stringify(data))
    }
  }, [location, explored, isTracking, isMapReady])

  const startTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== "granted") {
      Alert.alert("Permission denied", "We need location access to explore!")
      return
    }

    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        timeInterval: 2000,
        distanceInterval: 10,
      },
      async (loc) => { // Made async for DB call
        console.log("GPS Update:", loc.coords.latitude, loc.coords.longitude)
        const { latitude, longitude } = loc.coords
        const current = { latitude, longitude }
        setLocation(current)

        const isNew = !explored.some((pt) => getDistance(pt, current) < 30)

        if (isNew) {
          try {
            await db.runAsync("INSERT INTO explored_points (latitude, longitude, timestamp) VALUES (?, ?, ?)", [
              latitude,
              longitude,
              Date.now(),
            ])
            setExplored((prev) => [...prev, current])
          } catch (e) { console.log("Insert Error", e) }
        }
      },
    )

    setWatcher(sub)
    setIsTracking(true)
  }

  const stopTracking = () => {
    watcher?.remove()
    setWatcher(null)
    setIsTracking(false)
  }

  const toggleTracking = () => (isTracking ? stopTracking() : startTracking())

  const reset = () => {
    Alert.alert("Reset Exploration", "Are you sure you want to clear your map?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          try {
            await db.runAsync("DELETE FROM explored_points")
            setExplored([])
            if (webviewRef.current) {
              webviewRef.current.postMessage(JSON.stringify({ type: 'update', points: [] }))
            }
          } catch (e) { console.log("Reset Error", e) }
        },
      },
    ])
  }

  const getDistance = (a: Coordinate, b: Coordinate) => {
    const R = 6371e3
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const dLat = toRad(b.latitude - a.latitude)
    const dLon = toRad(b.longitude - a.longitude)
    const lat1 = toRad(a.latitude)
    const lat2 = toRad(b.latitude)

    const a_ =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a_), Math.sqrt(1 - a_))
    return R * c
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        style={styles.webview}
        source={require('../../assets/map.html')}
        originWhitelist={['*']}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onLoadEnd={() => {
          console.log("WebView Loaded. Waiting for Bridge...");
          setTimeout(() => {
            console.log("Bridge Ready.");
            setIsMapReady(true);
          }, 500);
        }}
        onError={(e) => console.log("WebView Error", e.nativeEvent)}
      />

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={toggleTracking}>
            <Text style={styles.buttonText}>
              {isTracking ? "Stop" : "Start"} Exploring
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: "#ef4444", marginTop: 10 }]}
          onPress={reset}
        >
          <Text style={styles.buttonText}>Reset Map</Text>
        </TouchableOpacity>

        {/* Dev Tools for Verification */}
        <View style={styles.devTools}>
          <Text style={styles.devTitle}>Dev Tools</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.smallButton, { backgroundColor: "#10b981" }]}
              onPress={async () => {
                // Simulate adding points nearby
                const isFallback = !location
                const baseLat = location?.latitude || 22.3149 // Fallback to KGP
                const baseLon = location?.longitude || 87.3105
                const newPoints: Coordinate[] = []

                // Add 5 points in a small line
                for (let i = 0; i < 5; i++) {
                  newPoints.push({
                    latitude: baseLat + (i * 0.0002),
                    longitude: baseLon + (i * 0.0002)
                  })
                }

                // Insert into DB
                try {
                  for (const p of newPoints) {
                    await db.runAsync("INSERT INTO explored_points (latitude, longitude, timestamp) VALUES (?, ?, ?)", [
                      p.latitude,
                      p.longitude,
                      Date.now(),
                    ])
                  }
                  // Update UI
                  setExplored(prev => [...prev, ...newPoints])

                  Alert.alert(
                    "Simulated",
                    isFallback ? "Added points at KGP (Fallback)." : "Added 5 test points."
                  )
                } catch (e) { console.log("Sim Error", e) }
              }}
            >
              <Text style={styles.smallButtonText}>+ Simulate Walk</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.smallButton, { backgroundColor: "#8b5cf6" }]}
              onPress={() => {
                // Clear state and force reload from DB
                setExplored([])
                setTimeout(async () => {
                  try {
                    const result = await db.getAllAsync("SELECT latitude, longitude FROM explored_points") as Coordinate[]
                    setExplored(result)
                    Alert.alert("Reloaded", `Synced ${result.length} points to Web Map.`)
                  } catch (e) { console.log("Reload Error", e) }
                }, 500)
              }}
            >
              <Text style={styles.smallButtonText}>↻ Sync Web</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.status}>Explored: {explored.length} points</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  controls: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
    alignItems: "center",
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd'
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
    justifyContent: "center",
  },
  button: {
    backgroundColor: "#3b82f6",
    padding: 12,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center'
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
    textAlign: "center",
  },
  status: {
    color: "#333",
    marginTop: 10,
    fontSize: 12,
  },
  devTools: {
    marginTop: 15,
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 10,
    alignItems: "center"
  },
  devTitle: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#888",
    marginBottom: 5,
    textTransform: "uppercase"
  },
  smallButton: {
    padding: 8,
    borderRadius: 6,
    minWidth: 100,
    alignItems: 'center'
  },
  smallButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 12
  }
})
