/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  CameraOff, 
  Volume2,
  VolumeX,
  Activity, 
  Moon,
  Sun,
  Circle, 
  ShieldAlert, 
  Cpu, 
  Eye, 
  Terminal,
  Wifi,
  Database,
  Lock,
  Battery,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  EyeOff,
  Focus,
  Brain,
  Search,
  Sliders,
  Users
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

// Types for motion detection
interface Point {
  x: number;
  y: number;
}

interface AIDetection {
  label: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  confidence: number;
  gender?: string;
  characteristics?: string;
}

interface AIResponse {
  detections: AIDetection[];
  scene_summary: string;
}

interface TrackedObject extends AIDetection {
  id: number;
  lastSeen: number;
  isActive: boolean;
}

enum SystemStatus {
  OFF = 'CAMERA OFF',
  ACTIVE = 'LIVE CAMERA ACTIVE',
  RECORDING = 'RECORDING',
  ERROR = 'SYSTEM ERROR'
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<SystemStatus>(SystemStatus.OFF);
  const [motionLevel, setMotionLevel] = useState(0);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [lastFrame, setLastFrame] = useState<ImageData | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [detectedPoints, setDetectedPoints] = useState<Point[]>([]);
  const [motionGrid, setMotionGrid] = useState<boolean[]>(new Array(64).fill(false));
  const [logs, setLogs] = useState<{ time: string; msg: string; type: 'info' | 'alert' | 'match' }[]>([
    { time: '14:02:12', msg: 'SYSTEM_SYNC_OK', type: 'info' }
  ]);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [focusLevel, setFocusLevel] = useState(0);
  const [sensitivity, setSensitivity] = useState(50);
  const [nightVision, setNightVision] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  
  // AI States
  const [aiEnabled, setAiEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [aiDetections, setAiDetections] = useState<AIDetection[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  const nextId = useRef(1);

  const genAI = useMemo(() => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }), []);
  const lastAlertTime = useRef(0);
  const lastMotionTime = useRef(0);

  // Speech function
  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    
    // Stop any current speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    
    // Attempt to find an Indonesian voice
    let voices = window.speechSynthesis.getVoices();
    
    // Speech synthesis voices are loaded asynchronously
    const setVoice = () => {
      const idVoice = voices.find(v => v.lang.startsWith('id') || v.name.includes('Indonesian'));
      if (idVoice) utterance.voice = idVoice;
      utterance.rate = 1.4; // Faster speech for "no delay" feel
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    };

    if (voices.length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        voices = window.speechSynthesis.getVoices();
        setVoice();
      };
    } else {
      setVoice();
    }
  }, [voiceEnabled]);

  const toggleVoice = () => {
    const newState = !voiceEnabled;
    setVoiceEnabled(newState);
    if (newState) {
      setTimeout(() => {
        speak("Protokol suara diaktifkan. Saya siap mengawasi perimeter.");
      }, 100);
    }
  };

  // Update clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Update logs and trigger motion voice alerts
  useEffect(() => {
    if (status === SystemStatus.OFF) return;
    
    // Request notification permission on first motion
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const interval = setInterval(() => {
      if (motionLevel > 15) {
        const now = Date.now();
        // Reduced cooldown to 6s for motion alerts
        if (voiceEnabled && now - lastMotionTime.current > 6000) {
          const phrases = [
            "Perhatian! Ada pergerakan di sektor pemantauan.",
            "Sensor aktif. Saya mendeteksi aktivitas mencurigakan.",
            "Peringatan. Sesuatu bergerak di hadapan kamera.",
            "Aktivitas terdeteksi. Memulai verifikasi visual."
          ];
          speak(phrases[Math.floor(Math.random() * phrases.length)]);
          lastMotionTime.current = now;
          
          // Browser Notification
          if (Notification.permission === 'granted') {
            new Notification('AI SECURITY ALERT', {
              body: 'Terdeteksi pergerakan di area pemantauan.',
              silent: true
            });
          }
        }

        setLogs(prev => [
          { time: new Date().toLocaleTimeString().slice(0, 8), msg: 'SYSTEM_ALERT: MOTION_DET', type: 'alert' },
          ...prev.slice(0, 10)
        ]);
      }
    }, 1500); 
    return () => clearInterval(interval);
  }, [status, motionLevel, voiceEnabled, speak]);

  // AI Detection Loop
  const performAiDetection = useCallback(async (forceVoice = false) => {
    if (!aiEnabled || (isAiProcessing && !forceVoice) || !videoRef.current || videoRef.current.readyState < 2) return;

    setIsAiProcessing(true);
    try {
      // Capture current frame
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(videoRef.current, 0, 0);
      
      const base64Image = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: "Lakukan analisis visual pada frame CCTV ini. Berikan daftar objek yang dideteksi dan ringkasan situasi keseluruhan. Untuk setiap objek, berikan label singkat dalam Bahasa Indonesia, kotak pembatas normalized [ymin, xmin, ymax, xmax], gender jika orang, dan ciri-ciri visual yang mencolok. Berikan juga 'scene_summary' yang menjelaskan apa yang sedang terjadi dalam satu kalimat interaktif." },
              { inlineData: { mimeType: "image/jpeg", data: base64Image } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    box_2d: { 
                      type: Type.ARRAY,
                      items: { type: Type.NUMBER },
                      description: "[ymin, xmin, ymax, xmax]"
                    },
                    confidence: { type: Type.NUMBER },
                    gender: { type: Type.STRING },
                    characteristics: { type: Type.STRING }
                  },
                  required: ["label", "box_2d"]
                }
              },
              scene_summary: { type: Type.STRING }
            },
            required: ["detections", "scene_summary"]
          }
        }
      });

      const aiData: AIResponse = JSON.parse(response.text);
      const detections = aiData.detections;
      setAiDetections(detections);
      
      const now = Date.now();
      setTrackedObjects(prev => {
        const updated = [...prev].map(t => ({ ...t, isActive: false }));
        const currentDetections = [...detections];
        
        currentDetections.forEach(det => {
          let bestMatchIdx = -1;
          let minDistance = 150; // Threshold for matching (normalized units)

          updated.forEach((track, idx) => {
            if (track.label === det.label && !track.isActive) {
              const detCenter = { 
                y: (det.box_2d[0] + det.box_2d[2]) / 2, 
                x: (det.box_2d[1] + det.box_2d[3]) / 2 
              };
              const trackCenter = { 
                y: (track.box_2d[0] + track.box_2d[2]) / 2, 
                x: (track.box_2d[1] + track.box_2d[3]) / 2 
              };
              const dist = Math.sqrt(Math.pow(detCenter.x - trackCenter.x, 2) + Math.pow(detCenter.y - trackCenter.y, 2));
              
              if (dist < minDistance) {
                minDistance = dist;
                bestMatchIdx = idx;
              }
            }
          });

          if (bestMatchIdx !== -1) {
            updated[bestMatchIdx] = {
              ...updated[bestMatchIdx],
              box_2d: det.box_2d,
              gender: det.gender || updated[bestMatchIdx].gender,
              characteristics: det.characteristics || updated[bestMatchIdx].characteristics,
              lastSeen: now,
              isActive: true
            };
          } else {
            // New track
            const id = nextId.current++;
            updated.push({
              ...det,
              id,
              lastSeen: now,
              isActive: true
            });
            
            // Log entry
            setLogs(prevLogs => [
              { 
                time: new Date().toLocaleTimeString().slice(0, 8), 
                msg: `OBJ_ENTER: ${det.label} [#${id}]`, 
                type: 'match' 
              },
              ...prevLogs.slice(0, 10)
            ]);
          }
        });

        // Filter out tracks not seen for 15 seconds
        const finalTracks = updated.filter(t => {
          const isAlive = now - t.lastSeen < 15000;
          if (!isAlive) {
            setLogs(prevLogs => [
              { 
                time: new Date().toLocaleTimeString().slice(0, 8), 
                msg: `OBJ_EXIT: ${t.label} [#${t.id}]`, 
                type: 'info' 
              },
              ...prevLogs.slice(0, 10)
            ]);
          }
          return isAlive;
        });

        return finalTracks;
      });

      if (detections.length > 0 || aiData.scene_summary) {
        const labels = detections.map(d => d.label);
        
        // Voice report for recognized objects
        const now = Date.now();
        // 5 second cooldown for automatic reports, forceVoice bypasses it
        if (voiceEnabled && (forceVoice || now - lastAlertTime.current > 5000)) {
          if (aiData.scene_summary) {
            speak(aiData.scene_summary);
          } else {
            const humanDetection = detections.find(d => d.label.toLowerCase().includes('orang') || d.label.toLowerCase().includes('manusia'));
            
            let aiPhrases: string[] = [];
            if (humanDetection) {
              const gender = humanDetection.gender ? `seorang ${humanDetection.gender}` : 'seorang manusia';
              const details = humanDetection.characteristics ? `. Deskripsi visual: ${humanDetection.characteristics}` : '';
              aiPhrases = [
                `Analisis visual mendeteksi ${gender}${details}.`,
                `Target terpantau. Saya melihat ${gender} di area. ${humanDetection.characteristics || ''}`,
                `Peringatan keamanan. ${gender} terdeteksi. Ciri-ciri: ${humanDetection.characteristics || 'tidak tersedia'}.`,
                `Identitas terkonfirmasi. ${gender} di sektor pusat. ${details}`
              ];
            } else {
              const activeLabels = [...new Set(detections.map(d => d.label))];
              aiPhrases = [
                `Analisis visual selesai. Saya melihat ada ${activeLabels.join(' dan ')}.`,
                `Area aman untuk entitas organik, namun saya mendeteksi ${activeLabels.join(', ')}.`,
                `Objek teridentifikasi: ${activeLabels.join(' dan ')}.`
              ];
            }
            speak(aiPhrases[Math.floor(Math.random() * aiPhrases.length)]);
          }
          lastAlertTime.current = now;
        }

        setLogs(prev => [
          { 
            time: new Date().toLocaleTimeString().slice(0, 8), 
            msg: `AI_DET: ${labels.join(', ')}`, 
            type: 'match' 
          },
          ...prev.slice(0, 10)
        ]);
      }
    } catch (error) {
      console.error("AI Error:", error);
    } finally {
      setIsAiProcessing(false);
    }
  }, [aiEnabled, isAiProcessing, genAI]);

  useEffect(() => {
    const aiInterval = setInterval(() => {
      // Faster AI trigger when motion exists (2.5s instead of 3s)
      if (status !== SystemStatus.OFF && (motionLevel > 3 || Math.random() > 0.8)) {
        performAiDetection();
      }
    }, 2500);
    return () => clearInterval(aiInterval);
  }, [status, motionLevel, performAiDetection]);

  // Initialize Camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setStatus(SystemStatus.ACTIVE);
        setHasPermission(true);
        speak("Sistem Neural Eye aktif. Semua sektor dalam pemantauan.");
      }
    } catch (err) {
      console.error("Camera error:", err);
      setHasPermission(false);
      setStatus(SystemStatus.ERROR);
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  // Motion Detection Loop
  useEffect(() => {
    let animationId: number;
    const detectMotion = () => {
      if (!videoRef.current || !canvasRef.current || status === SystemStatus.OFF || status === SystemStatus.ERROR) {
        animationId = requestAnimationFrame(detectMotion);
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
        animationId = requestAnimationFrame(detectMotion);
        return;
      }

      // Draw current frame to small canvas for processing
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (lastFrame) {
        let diffCount = 0;
        const newPoints: Point[] = [];
        const newGrid = new Array(64).fill(false);
        const threshold = Math.max(3, 40 - (sensitivity / 2.5));

        for (let i = 0; i < currentFrame.data.length; i += 8) { // Deep sampling for hyper-sensitivity
          const r1 = currentFrame.data[i];
          const g1 = currentFrame.data[i + 1];
          const b1 = currentFrame.data[i + 2];

          const r2 = lastFrame.data[i];
          const g2 = lastFrame.data[i + 1];
          const b2 = lastFrame.data[i + 2];

          const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
          if (diff > threshold) {
            diffCount++;
            
            const x = (i / 4) % canvas.width;
            const y = Math.floor((i / 4) / canvas.width);
            
            // Map to 8x8 grid
            const gridX = Math.floor((x / canvas.width) * 8);
            const gridY = Math.floor((y / canvas.height) * 8);
            newGrid[gridY * 8 + gridX] = true;

            if (newPoints.length < 16) { // More visual tracking points
              newPoints.push({ x, y });
            }
          }
        }

        const level = (diffCount / (canvas.width * canvas.height / 2)) * 100;
        setMotionLevel(Math.min(level * (sensitivity / 2.5), 100));
        setDetectedPoints(newPoints);
        setMotionGrid(newGrid);
      }

      setLastFrame(currentFrame);
      animationId = requestAnimationFrame(detectMotion);
    };

    animationId = requestAnimationFrame(detectMotion);
    return () => cancelAnimationFrame(animationId);
  }, [lastFrame, status, sensitivity]);

  const toggleRecording = () => {
    if (status === SystemStatus.ACTIVE) {
      setStatus(SystemStatus.RECORDING);
      speak("Perekaman dimulai. Mengarsipkan data visual ke dalam memori.");
    } else if (status === SystemStatus.RECORDING) {
      setStatus(SystemStatus.ACTIVE);
      speak("Perekaman dihentikan. Data telah tersimpan.");
    }
  };

  return (
    <div className="fixed inset-0 bg-[#050505] text-[#00FF41] font-mono overflow-hidden select-none touch-none border-4 border-[#0a1a10] p-4 flex flex-col">
      {/* Background Grid */}
      <div className="absolute inset-0 opacity-10 pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(rgba(0, 255, 65, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 65, 0.1) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      {/* Header HUD */}
      <header className="flex justify-between items-center border-b border-[#00FF41] pb-2 mb-4 relative z-10 shrink-0">
        <div className="flex items-center gap-4"> 
          <div className={`w-4 h-4 rounded-full ${status === SystemStatus.RECORDING ? 'bg-red-600 animate-pulse' : 'bg-[#00FF41] animate-pulse opacity-50'}`}></div>
          <h1 className="text-2xl font-black tracking-tighter">
            NEURAL-EYE v4.1.0 // <span className={status === SystemStatus.RECORDING ? 'text-red-500' : 'text-white'}>{status}</span>
          </h1>
          <div className={`hidden md:flex items-center gap-2 px-2 py-0.5 border ${aiEnabled ? 'border-[#00FF41] text-[#00FF41]' : 'border-red-900 text-red-900'} text-[10px] uppercase font-bold`}>
            <Brain className="w-3 h-3" />
            Neural Core: {aiEnabled ? 'Online' : 'Offline'}
          </div>
          <div className={`hidden md:flex items-center gap-2 px-2 py-0.5 border ${voiceEnabled ? 'border-[#00FF41] text-[#00FF41]' : 'border-red-900 text-red-900'} text-[10px] uppercase font-bold`}>
            {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            Audio: {voiceEnabled ? 'Ready' : 'Muted'}
          </div>
          <div className={`hidden md:flex items-center gap-2 px-2 py-0.5 border ${nightVision ? 'border-cyan-500 text-cyan-400' : 'border-[#00FF41]/30 text-[#00FF41]/50'} text-[10px] uppercase font-bold`}>
            {nightVision ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
            Night Vision: {nightVision ? 'ON' : 'OFF'}
          </div>
        </div>
        <div className="text-right"> 
          <div className="text-xs opacity-70">SYS_REF: NC-9921-X</div>
          <div className="text-lg font-bold">{currentTime.toLocaleDateString()} {currentTime.toLocaleTimeString()}</div>
        </div>
      </header>
      
      {/* Main Content Area */}
      <main className="flex-1 grid grid-cols-12 gap-4 relative z-10 overflow-hidden">
        
        {/* Camera Viewport (col-8) */}
        <div 
          className="col-span-12 lg:col-span-8 flex flex-col relative bg-[#0a0a0a] border border-[#00FF41]/30 overflow-hidden shadow-[inset_0_0_100px_rgba(0,255,65,0.05)] cursor-crosshair group"
          onMouseEnter={() => setControlsVisible(true)}
          onMouseLeave={() => setControlsVisible(false)}
          onClick={() => setControlsVisible(true)}
        >
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover transition-all duration-300"
            style={{ 
              transform: `scale(${zoomLevel})`,
              filter: nightVision 
                ? `contrast(1.4) brightness(1.2) grayscale(1) sepia(1) hue-rotate(80deg) blur(${focusLevel}px)`
                : `contrast(1.25) saturate(1.5) grayscale(0.3) blur(${focusLevel}px)`
            }}
          />
          
          <canvas ref={canvasRef} width="160" height="90" className="hidden" />

          {/* HUD Overlays */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Corners */}
            <div className="absolute top-4 left-4 w-12 h-12 border-t-2 border-l-2 border-[#00FF41]" />
            <div className="absolute top-4 right-4 w-12 h-12 border-t-2 border-r-2 border-[#00FF41]" />
            <div className="absolute bottom-4 left-4 w-12 h-12 border-b-2 border-l-2 border-[#00FF41]" />
            <div className="absolute bottom-4 right-4 w-12 h-12 border-b-2 border-r-2 border-[#00FF41]" />

            {/* Scanning Line */}
            <motion.div 
              animate={{ top: ['0%', '100%', '0%'] }}
              transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
              className="absolute left-0 right-0 h-[1px] bg-[#00FF41]/50 shadow-[0_0_20px_#00FF41] z-10"
            />

            {/* Center Reticle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center opacity-20 transition-transform duration-300" style={{ transform: `scale(${zoomLevel}) translate(-50%, -50%)`, transformOrigin: '0 0' }}>
              <div className="w-32 h-32 border-2 border-[#00FF41]/20 rounded-full flex items-center justify-center">
                <div className="w-1 h-32 bg-[#00FF41]/40 absolute"></div>
                <div className="h-1 w-32 bg-[#00FF41]/40 absolute"></div>
              </div>
            </div>

            {/* Visual Motion Meter (On-Camera Indicator) */}
            <div className="absolute left-6 top-1/4 bottom-1/4 w-1.5 bg-black/40 border border-[#00FF41]/20 z-40 overflow-hidden backdrop-blur-sm">
              <motion.div 
                animate={{ height: `${motionLevel}%` }}
                className={`absolute bottom-0 left-0 w-full transition-colors duration-300 ${motionLevel > 50 ? 'bg-red-500 shadow-[0_0_15px_#ef4444]' : 'bg-[#00FF41] shadow-[0_0_10px_#00FF41]'}`}
              />
              <div className="absolute top-0 left-full ml-1 text-[8px] text-[#00FF41] font-black tracking-widest uppercase transform rotate-90 origin-top-left -translate-y-full whitespace-nowrap opacity-70">
                MOTION_LVL
              </div>
            </div>

            {/* Motion Warning Badge */}
            <AnimatePresence>
              {motionLevel > 20 && (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="absolute top-16 right-4 z-40 bg-red-600/90 text-white px-3 py-1.5 text-[10px] font-black uppercase flex items-center gap-2 shadow-[0_0_20px_rgba(220,38,38,0.5)] border border-red-400/50"
                >
                  <motion.div 
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ repeat: Infinity, duration: 0.5 }}
                    className="w-2.5 h-2.5 bg-white rounded-full"
                  />
                  Motion Alert
                </motion.div>
              )}
            </AnimatePresence>

            {/* Motion Sensor Grid Matrix (Subtle Version) */}
            <div className="absolute inset-0 grid grid-cols-8 grid-rows-8 pointer-events-none opacity-20">
              {motionGrid.map((active, i) => (
                <div 
                  key={i} 
                  className={`border-[0.5px] border-[#00FF41]/5 transition-colors duration-150 ${active ? 'bg-[#00FF41]/20' : 'bg-transparent'}`}
                />
              ))}
            </div>

            {/* AI Recognition Overlays */}
            <AnimatePresence>
              {aiEnabled && trackedObjects.map((obj) => (
                <motion.div
                  key={`track-${obj.id}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: obj.isActive ? 1 : 0.4, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className={`absolute border-2 ${obj.isActive ? 'border-[#00FF41]' : 'border-[#00FF41]/30'} z-30 transition-colors duration-500`}
                  style={{
                    top: `${obj.box_2d[0] / 10}%`,
                    left: `${obj.box_2d[1] / 10}%`,
                    width: `${(obj.box_2d[3] - obj.box_2d[1]) / 10}%`,
                    height: `${(obj.box_2d[2] - obj.box_2d[0]) / 10}%`,
                    boxShadow: obj.isActive ? '0 0 15px rgba(0, 255, 65, 0.3)' : 'none'
                  }}
                >
                  <div className={`absolute top-0 left-0 ${obj.isActive ? 'bg-[#00FF41] text-black' : 'bg-black text-[#00FF41] border border-[#00FF41]/30'} text-[10px] font-black px-1 uppercase whitespace-nowrap -translate-y-full flex flex-col gap-0`}>
                    <div className="flex gap-2">
                      <span>{obj.label}</span>
                      <span className="opacity-70">ID: #{obj.id}</span>
                    </div>
                    {obj.gender && (
                      <div className="text-[8px] opacity-80 border-t border-black/20 mt-0.5">
                        {obj.gender} {obj.characteristics ? `| ${obj.characteristics}` : ''}
                      </div>
                    )}
                  </div>
                  {/* Visual scan line for active objects */}
                  {obj.isActive && (
                    <motion.div 
                      animate={{ top: ['0%', '100%'] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                      className="absolute left-0 right-0 h-[1px] bg-[#00FF41]/40"
                    />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* AI Status Indicator */}
            <div className="absolute bottom-4 right-4 flex items-center gap-2">
              {isAiProcessing && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 bg-black/60 border border-[#00FF41]/40 px-2 py-1"
                >
                  <Cpu className="w-3 h-3 animate-spin text-[#00FF41]" />
                  <span className="text-[10px] tracking-widest text-[#00FF41] animate-pulse">AI ANALYZING...</span>
                </motion.div>
              )}
            </div>

            {/* Neural Zoom & Focus Controls */}
            <AnimatePresence>
              {controlsVisible && (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-4 pointer-events-auto z-30"
                >
                  <div className="flex flex-col gap-1 bg-black/60 border border-[#00FF41]/40 p-2 backdrop-blur-md">
                    <div className="text-[10px] text-[#00FF41] uppercase mb-1 flex items-center gap-1"><Maximize className="w-2 h-2" /> Zoom</div>
                    <div className="flex flex-col gap-2">
                       <button 
                        onClick={(e) => { e.stopPropagation(); setZoomLevel(prev => Math.min(prev + 0.2, 3)); }}
                        className="p-1.5 hover:bg-[#00FF41] hover:text-black transition-colors border border-[#00FF41]/20"
                       >
                         <ZoomIn className="w-4 h-4" />
                       </button>
                       <div className="h-12 w-full bg-[#00FF41]/10 relative">
                          <div className="absolute bottom-0 left-0 w-full bg-[#00FF41]/40" style={{ height: `${((zoomLevel - 1) / 2) * 100}%` }} />
                       </div>
                       <button 
                        onClick={(e) => { e.stopPropagation(); setZoomLevel(prev => Math.max(prev - 0.2, 1)); }}
                        className="p-1.5 hover:bg-[#00FF41] hover:text-black transition-colors border border-[#00FF41]/20"
                       >
                         <ZoomOut className="w-4 h-4" />
                       </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 bg-black/60 border border-[#00FF41]/40 p-2 backdrop-blur-md">
                    <div className="text-[10px] text-[#00FF41] uppercase mb-1 flex items-center gap-1"><Focus className="w-2 h-2" /> Focus</div>
                    <div className="flex flex-col gap-2">
                       <button 
                        onClick={(e) => { e.stopPropagation(); setFocusLevel(prev => Math.min(prev + 1, 10)); }}
                        className="p-1.5 hover:bg-[#00FF41] hover:text-black transition-colors border border-[#00FF41]/20"
                       >
                         <Minimize className="w-4 h-4" />
                       </button>
                       <div className="h-12 w-full bg-[#00FF41]/10 relative">
                          <div className="absolute bottom-0 left-0 w-full bg-[#00FF41]/40" style={{ height: `${(focusLevel / 10) * 100}%` }} />
                       </div>
                       <button 
                        onClick={(e) => { e.stopPropagation(); setFocusLevel(prev => Math.max(prev - 1, 0)); }}
                        className="p-1.5 hover:bg-[#00FF41] hover:text-black transition-colors border border-[#00FF41]/20"
                       >
                         <Eye className="w-4 h-4" />
                       </button>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-1 bg-black/60 border border-[#00FF41]/40 p-2 backdrop-blur-md">
                    <div className="text-[10px] text-[#00FF41] uppercase mb-1 flex items-center gap-1"><Sliders className="w-2 h-2" /> Sens</div>
                    <div className="h-24 w-8 bg-[#00FF41]/10 relative group cursor-pointer border border-[#00FF41]/20 overflow-hidden"
                         onClick={(e) => {
                           e.stopPropagation();
                           const rect = e.currentTarget.getBoundingClientRect();
                           const y = e.clientY - rect.top;
                           const val = Math.round(100 - (y / rect.height) * 100);
                           setSensitivity(Math.max(0, Math.min(100, val)));
                         }}>
                       <div className="absolute bottom-0 left-0 w-full bg-[#00FF41] shadow-[0_0_10px_#00FF41]" style={{ height: `${sensitivity}%` }} />
                       <div className="absolute inset-0 flex items-center justify-center text-[8px] font-black pointer-events-none mix-blend-difference">{sensitivity}</div>
                    </div>
                  </div>
                  
                  <button 
                    onClick={(e) => { e.stopPropagation(); setZoomLevel(1); setFocusLevel(0); setSensitivity(50); }}
                    className="p-2 bg-[#00FF41] text-black font-black text-[10px] uppercase hover:bg-white transition-colors border border-[#00FF41]"
                  >
                    RESET
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Motion Tracking Markers */}
            {detectedPoints.map((p, i) => (
              <motion.div
                key={`p-${i}-${p.x}-${p.y}`}
                initial={{ opacity: 0, scale: 1.5 }}
                animate={{ 
                  opacity: [0, 1, 0], 
                  scale: [1.1, 1, 0.9],
                  boxShadow: [
                    '0 0 0px rgba(0, 255, 65, 0)',
                    '0 0 10px rgba(0, 255, 65, 0.4)',
                    '0 0 0px rgba(0, 255, 65, 0)'
                  ]
                }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="absolute w-8 h-8 border border-[#00FF41]/60 z-20"
                style={{ 
                  left: `${(p.x / 160) * 100}%`, 
                  top: `${(p.y / 90) * 100}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                <div className="absolute top-0 left-0 text-[8px] text-black bg-[#00FF41] px-1 font-bold">MOV_LOG_{i}</div>
              </motion.div>
            ))}

            {/* Status Overlay Info */}
            <div className="absolute bottom-4 left-4 text-[10px] space-y-1 bg-black/60 p-2 border border-[#00FF41]/20 backdrop-blur-md">
              <div className="flex gap-2 items-center mb-1 border-b border-[#00FF41]/20 pb-1">
                <Activity className={`w-3 h-3 ${motionLevel > 20 ? 'text-red-500 animate-pulse' : 'text-[#00FF41]'}`} />
                <span className="font-bold tracking-tighter">SENSOR_STATUS: {motionLevel > 20 ? 'ACTIVITY' : 'STABLE'}</span>
              </div>
              <div className="flex gap-2"><span>ISO:</span> <span className="text-white">800</span></div>
              <div className="flex gap-2"><span>EXP:</span> <span className="text-white">1/50</span></div>
              <div className="flex gap-2"><span>F:</span> <span className="text-white">2.8</span></div>
              <div className="flex gap-2"><span>LENS:</span> <span className="text-white">35MM</span></div>
            </div>

            {/* Recording Indicator */}
            <div className="absolute top-4 right-4 text-xs font-bold flex flex-col items-end">
              {status === SystemStatus.RECORDING && (
                <div className="bg-red-600 text-white px-2 py-1 flex items-center gap-2 mb-2 animate-pulse">
                  <div className="w-2 h-2 bg-white rounded-full"></div> RECORDING
                </div>
              )}
              <div className="bg-black/80 p-2 border border-[#00FF41]/20 text-white font-mono">
                {currentTime.toLocaleTimeString()}
              </div>
            </div>
          </div>

          {/* Error Message */}
          <AnimatePresence>
            {hasPermission === false && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-8 text-center z-50"
              >
                <ShieldAlert className="w-16 h-16 text-red-600 mb-4" />
                <h2 className="text-2xl font-black mb-2 text-red-500">PERIMETER BREACH ENFORCED</h2>
                <p className="opacity-70 max-w-sm mb-6 text-sm">Optical sensor authorization required. Grant system access to resume neural monitoring.</p>
                <button 
                  onClick={startCamera}
                  className="px-8 py-3 bg-[#00FF41] text-black font-black uppercase hover:bg-white transition-colors"
                >
                  Authorize System
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sidebar Info (col-4) */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-4 overflow-hidden h-full">
          {/* Motion Log */}
          <div className="bg-[#0a1a10] border border-[#00FF41]/40 p-4 h-1/2 overflow-hidden flex flex-col relative">
             <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 1px, #00FF41 1px, #00FF41 2px)', backgroundSize: '100% 4px' }} />
             <h3 className="text-xs uppercase tracking-widest border-b border-[#00FF41]/20 pb-1 mb-4 relative z-10 text-white">Motion Detection Log</h3>
             <div className="flex-1 text-[11px] space-y-3 opacity-80 overflow-y-auto pr-2 custom-scrollbar relative z-10">
                {logs.map((log, idx) => (
                  <div key={idx} className="flex justify-between items-start gap-4">
                    <span className="opacity-50">{log.time}</span>
                    <span className={log.type === 'alert' ? 'text-red-500 font-bold' : log.type === 'match' ? 'text-white' : 'text-[#00FF41]'}>
                      {log.msg}
                    </span>
                  </div>
                ))}
                {motionLevel > 50 && (
                   <div className="flex justify-between text-red-500 font-black animate-pulse">
                     <span>{currentTime.toLocaleTimeString().slice(0, 8)}</span>
                     <span>PERIMETER BREACH</span>
                   </div>
                )}
             </div>
          </div>

          {/* Live Entity Feed */}
          <div className="bg-[#0a1a10] border border-[#00FF41]/40 p-4 h-1/2 overflow-hidden flex flex-col relative">
            <div className="flex justify-between items-center border-b border-[#00FF41]/20 pb-1 mb-4">
              <h3 className="text-xs uppercase tracking-widest text-white">Live Entity Feed</h3>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[#00FF41] rounded-full animate-pulse" />
                <span className="text-[8px] text-[#00FF41] font-mono">ACTIVE_ID: {trackedObjects.filter(t => t.isActive).length}</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1">
              {trackedObjects.filter(t => t.isActive).length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-2">
                  <Focus className="w-8 h-8 animate-pulse" />
                  <span className="text-[10px] uppercase font-mono tracking-tighter">Scanning for dynamic entities...</span>
                </div>
              ) : (
                trackedObjects.filter(t => t.isActive).map((obj) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={obj.id} 
                    className="border-l-2 border-[#00FF41] bg-black/40 p-2 relative group overflow-hidden"
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[11px] font-black text-white uppercase">{obj.label}</span>
                      <span className="text-[9px] font-mono opacity-60">REF_ID_{obj.id}</span>
                    </div>
                    {obj.gender && (
                      <div className="text-[10px] text-[#00FF41] font-medium flex items-center gap-1">
                        <Users className="w-3 h-3" /> {obj.gender}
                      </div>
                    )}
                    {obj.characteristics && (
                      <div className="text-[9px] opacity-70 leading-tight mt-1 italic border-t border-[#00FF41]/10 pt-1">
                        {obj.characteristics}
                      </div>
                    )}
                    <div className="absolute top-0 right-0 w-8 h-full bg-[#00FF41]/5 skew-x-12 translate-x-4 pointer-events-none" />
                  </motion.div>
                ))
              )}
            </div>
            
            <div className="mt-4 pt-2 border-t border-[#00FF41]/10">
              <div className="flex flex-col gap-1">
                <div className="text-[10px] flex justify-between uppercase opacity-60">
                  <span>Sensor Neural Load</span>
                  <span>{Math.round(motionLevel)}%</span>
                </div>
                <div className="w-full h-1 bg-[#00FF41]/10">
                  <motion.div 
                    animate={{ width: `${motionLevel}%` }}
                    className="h-full bg-[#00FF41] shadow-[0_0_10px_#00FF41]"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer HUD */}
      <footer className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-end relative z-10 shrink-0">
        <div className="flex gap-2">
          <button 
            onClick={toggleRecording}
            className={`px-6 py-2 font-black text-xs uppercase transition-colors h-10 border-2
              ${status === SystemStatus.RECORDING 
                ? 'bg-red-600 text-white border-red-600' 
                : 'bg-[#00FF41] text-black border-[#00FF41] hover:bg-white hover:border-white'}`}
          >
            {status === SystemStatus.RECORDING ? 'STOP REC' : 'REC_START'}
          </button>
          <button 
            onClick={() => {
              const newState = !aiEnabled;
              setAiEnabled(newState);
              speak(newState ? "Inteligensi buatan diaktifkan. Memulai analisis pola." : "Inteligensi buatan dinonaktifkan.");
            }}
            className={`px-6 py-2 font-black text-xs uppercase transition-colors h-10 border-2
              ${aiEnabled 
                ? 'bg-[#00FF41] text-black border-[#00FF41] hover:bg-white' 
                : 'bg-black text-[#00FF41] border-[#00FF41] hover:bg-[#0a1a10]'}`}
          >
            {aiEnabled ? 'AI_CORE: ON' : 'AI_CORE: OFF'}
          </button>
          <button 
            onClick={toggleVoice}
            className={`px-4 py-2 font-black text-xs uppercase transition-colors h-10 border-2 flex items-center justify-center gap-2
              ${voiceEnabled 
                ? 'bg-[#00FF41] text-black border-[#00FF41] hover:bg-white' 
                : 'bg-black text-[#00FF41] border-[#00FF41] hover:bg-[#0a1a10]'}`}
            title="Toggle Voice Notifications"
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {voiceEnabled ? 'VOICE' : 'SILENT'}
          </button>
          <button 
            onClick={() => {
              const newState = !nightVision;
              setNightVision(newState);
              speak(newState ? "Mode penglihatan malam aktif. Mengoptimalkan sensor infra merah." : "Kembali ke mode spektrum normal.");
            }}
            className={`px-4 py-2 font-black text-xs uppercase transition-colors h-10 border-2 flex items-center justify-center gap-2
              ${nightVision 
                ? 'bg-cyan-600 text-white border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)]' 
                : 'bg-black text-[#00FF41] border-[#00FF41] hover:bg-[#0a1a10]'}`}
            title="Toggle Night Vision"
          >
            {nightVision ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            {nightVision ? 'NIGHT' : 'DAY'}
          </button>
          <button 
            onClick={() => {
              speak("Memulai pemindaian visual mendalam.");
              performAiDetection(true);
            }}
            className="border-2 border-[#00FF41] text-[#00FF41] px-6 py-2 font-black text-xs uppercase hover:bg-[#00FF41] hover:text-black transition-colors h-10 flex items-center gap-2 group"
          >
            <Search className="w-4 h-4 group-hover:scale-125 transition-transform" />
            AI SCAN
          </button>
          <button className="border-2 border-[#00FF41] text-[#00FF41] px-6 py-2 font-black text-xs uppercase hover:bg-[#00FF41] hover:text-black transition-colors h-10 hidden sm:block">
            SNAPSHOT
          </button>
        </div>

        <div className="text-center flex flex-col items-center">
          <div className="text-[10px] opacity-60 mb-1 tracking-widest">COORDINATES: 40.7128° N, 74.0060° W</div>
          <div className="flex gap-1.5 pt-1">
            {[...Array(5)].map((_, i) => (
              <div key={i} className={`w-2 h-2 ${i < 3 ? 'bg-[#00FF41]' : 'bg-[#00FF41]/20'}`}></div>
            ))}
          </div>
        </div>

        <div className="text-right text-[10px] opacity-60 leading-relaxed">
          NET_LATENCY: 12ms // BUFFER: 1024KB/S<br />
          SIGNAL_STRENGTH: 100% [ENCRYPTED]
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 255, 65, 0.05);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #00FF41;
        }
        @keyframes scan {
          from { transform: translateY(-100%); }
          to { transform: translateY(100%); }
        }
      `}</style>
    </div>
  );
}
