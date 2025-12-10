
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

// --- Types & Constants ---

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const GRAVITY = 0.5;
const FRICTION = 0.85;
const JUMP_FORCE = -11; 
const FOG_GRID_SIZE = 300; // Size of exploration chunks

// World Bounds for Minimap and Generation
const WORLD_MIN_X = -3500;
const WORLD_MAX_X = 3500;
const WORLD_MIN_Y = -1500;
const WORLD_MAX_Y = 2500;

type GamePhase = "MAIN_MENU" | "HERO_SELECT" | "PLAYING" | "RESULT";
type HeroType = "SWORDSMAN" | "MAGE";
type EntityType = "PLAYER" | "MOB_SLIME" | "MOB_BAT" | "ROGUE_AGENT" | "CHEST";
type LootRarity = "COMMON" | "EPIC" | "LEGENDARY" | "MYTHIC";
type PlatformType = "DIRT" | "STONE" | "WOOD" | "LAVA";

interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
  type: PlatformType;
}

interface Item {
  id: number;
  name: string;
  rarity: LootRarity;
  value: number;
  color: string;
}

interface Entity {
  id: number;
  type: EntityType;
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  facing: 1 | -1;
  attackCooldown: number;
  hitFlashTimer: number; // For visual feedback
  isDead: boolean;
  color: string;
  skillCooldown?: number;
  // Jump Mechanics
  jumpCount: number;
  isJumpKeyHeld: boolean;
  jumpCooldown?: number; // AI jump limiter
  // Chest specific
  isOpened?: boolean;
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  vy: number;
}

interface Rect {
  x: number; 
  y: number; 
  width: number; 
  height: number;
}

// --- Constants ---
const RARITY_CONFIG = {
  COMMON: { color: "#2ecc71", min: 1, max: 10 },
  EPIC: { color: "#9b59b6", min: 10, max: 30 }, 
  LEGENDARY: { color: "#f1c40f", min: 30, max: 80 },
  MYTHIC: { color: "#e74c3c", min: 200, max: 500 }
};

// --- Helper Functions ---

const rectIntersect = (r1: any, r2: any) => {
  return !(
    r2.x > r1.x + r1.width ||
    r2.x + r2.width < r1.x ||
    r2.y > r1.y + r1.height ||
    r2.y + r2.height < r1.y
  );
};

const getDistance = (e1: Entity, e2: Entity) => {
  const dx = (e1.x + e1.width/2) - (e2.x + e2.width/2);
  const dy = (e1.y + e1.height/2) - (e2.y + e2.height/2);
  return Math.sqrt(dx * dx + dy * dy);
};

// --- Draw Helpers (Cartoon Style) ---

const drawPlatform = (ctx: CanvasRenderingContext2D, p: Platform, time: number) => {
  if (p.type === "LAVA") {
      // Lava Pool visual
      const grad = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
      grad.addColorStop(0, "#e74c3c");
      grad.addColorStop(1, "#c0392b");
      ctx.fillStyle = grad;
      
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + p.height);
      ctx.lineTo(p.x, p.y);
      
      // Waves on top
      const waveFreq = 0.05;
      const waveAmp = 5;
      for(let i=0; i<=p.width; i+=10) {
          const wy = Math.sin((p.x + i) * waveFreq + time * 0.1) * waveAmp;
          ctx.lineTo(p.x + i, p.y + wy);
      }
      ctx.lineTo(p.x + p.width, p.y + p.height);
      ctx.fill();

      // Bubbles
      if (Math.random() > 0.9) {
          ctx.fillStyle = "#f1c40f";
          const bx = p.x + Math.random() * p.width;
          const by = p.y + Math.random() * p.height;
          ctx.beginPath();
          ctx.arc(bx, by, 3, 0, Math.PI*2);
          ctx.fill();
      }
      return;
  }

  if (p.type === "STONE") {
    ctx.fillStyle = "#34495e"; // Dark Blue Grey
    ctx.fillRect(p.x, p.y, p.width, p.height);
    ctx.fillStyle = "#2c3e50"; // Darker border
    ctx.fillRect(p.x + 5, p.y + 5, p.width - 10, p.height - 10);
    // Decor
    ctx.fillStyle = "#5d6d7e";
    ctx.fillRect(p.x + 10, p.y + 10, 10, 10);
    ctx.fillRect(p.x + p.width - 20, p.y + p.height - 20, 10, 10);

  } else if (p.type === "WOOD") {
    ctx.fillStyle = "#8d6e63"; // Wood
    ctx.fillRect(p.x, p.y, p.width, p.height);
    ctx.fillStyle = "#5d4037"; // Planks
    ctx.beginPath();
    ctx.moveTo(p.x + 10, p.y); ctx.lineTo(p.x + 10, p.y + p.height);
    ctx.moveTo(p.x + p.width - 10, p.y); ctx.lineTo(p.x + p.width - 10, p.y + p.height);
    ctx.moveTo(p.x, p.y + 5); ctx.lineTo(p.x + p.width, p.y + 5); // horizontal grain
    ctx.stroke();
  } else {
    // Dirt/Grass
    ctx.fillStyle = "#5d4037"; // Dirt
    ctx.fillRect(p.x, p.y, p.width, p.height);
    ctx.fillStyle = "#27ae60"; // Grass
    ctx.fillRect(p.x - 2, p.y - 5, p.width + 4, 10);
  }
};

const drawEntity = (ctx: CanvasRenderingContext2D, e: Entity, isHero: boolean) => {
  ctx.save();
  
  // Hit Flash
  if (e.hitFlashTimer > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
  }

  // Shadow
  if (e.type !== "MOB_BAT") {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(e.x + e.width/2, e.y + e.height, e.width/2, 6, 0, 0, Math.PI*2);
    ctx.fill();
  }

  // --- RENDERING LOGIC ---

  if (e.type === "CHEST") {
     // Glow
    if (!e.isOpened) {
      const time = Date.now() / 300;
      const scale = 1 + Math.sin(time) * 0.1;
      ctx.save();
      ctx.translate(e.x + e.width/2, e.y + e.height/2);
      ctx.scale(scale, scale);
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#f1c40f";
      ctx.fillStyle = "rgba(241, 196, 15, 0.2)";
      ctx.beginPath();
      ctx.arc(0, 0, 40, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
    // Chest Body
    ctx.fillStyle = e.isOpened ? "#5d4037" : "#a1887f";
    ctx.fillRect(e.x, e.y + 10, e.width, e.height - 10);
    // Lid
    ctx.fillStyle = e.isOpened ? "#3e2723" : "#8d6e63";
    if (e.isOpened) {
       ctx.beginPath();
       ctx.moveTo(e.x, e.y + 10);
       ctx.lineTo(e.x + e.width, e.y + 10);
       ctx.lineTo(e.x + e.width - 5, e.y - 10);
       ctx.lineTo(e.x + 5, e.y - 10);
       ctx.fill();
    } else {
       ctx.fillRect(e.x, e.y, e.width, 10);
    }
    // Lock
    ctx.fillStyle = "#f1c40f";
    ctx.fillRect(e.x + e.width/2 - 4, e.y + 8, 8, 8);

  } else if (e.type === "MOB_SLIME") {
    ctx.fillStyle = "#2ecc71";
    ctx.beginPath();
    // Clamp squash to ensure positive radius for ellipse
    const rawSquash = Math.abs(e.vy) * 2;
    const squash = Math.min(rawSquash, e.height - 6); 
    
    ctx.ellipse(e.x + e.width/2, e.y + e.height/2 + squash/2, e.width/2 + squash/2, Math.max(0.1, e.height/2 - squash/2), 0, Math.PI, 0); // Top round
    ctx.fill();
    ctx.fillRect(e.x - squash/2, e.y + e.height/2, e.width + squash, e.height/2);
    
    // Face
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(e.x + 10, e.y + 12, 4, 0, Math.PI*2);
    ctx.arc(e.x + 22, e.y + 12, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = "black";
    ctx.beginPath();
    ctx.arc(e.x + 10 + e.facing*2, e.y + 12, 2, 0, Math.PI*2);
    ctx.arc(e.x + 22 + e.facing*2, e.y + 12, 2, 0, Math.PI*2);
    ctx.fill();

  } else if (e.type === "MOB_BAT") {
    ctx.fillStyle = "#8e44ad";
    ctx.beginPath();
    ctx.arc(e.x + e.width/2, e.y + e.height/2, 10, 0, Math.PI*2);
    ctx.fill();
    // Wings
    const flap = Math.sin(Date.now() / 50) * 10;
    ctx.beginPath();
    ctx.moveTo(e.x + 5, e.y + 10);
    ctx.lineTo(e.x - 10, e.y + flap);
    ctx.lineTo(e.x + 5, e.y + 5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(e.x + 27, e.y + 10);
    ctx.lineTo(e.x + 42, e.y + flap);
    ctx.lineTo(e.x + 27, e.y + 5);
    ctx.fill();

  } else if (e.type === "PLAYER" || e.type === "ROGUE_AGENT") {
    const isRogue = e.type === "ROGUE_AGENT";
    
    // Rogue Red Aura
    if (isRogue) {
      ctx.strokeStyle = "#e74c3c";
      ctx.lineWidth = 2;
      ctx.strokeRect(e.x - 2, e.y - 2, e.width + 4, e.height + 4);
    }

    // Body
    ctx.fillStyle = isRogue ? "#c0392b" : e.color;
    ctx.fillRect(e.x + 8, e.y + 16, 16, 24); 
    
    // Head
    ctx.fillStyle = "#f1c40f"; // Skin
    ctx.fillRect(e.x + 6, e.y, 20, 18);
    
    // Helmet
    ctx.fillStyle = isRogue ? "#333" : (isHero && e.color === "#9b59b6" ? "#8e44ad" : "#2c3e50");
    ctx.fillRect(e.x + 4, e.y - 4, 24, 10);
    if (isRogue) {
       // Horns
       ctx.fillStyle = "#e74c3c";
       ctx.beginPath();
       ctx.moveTo(e.x + 4, e.y - 4); ctx.lineTo(e.x, e.y - 12); ctx.lineTo(e.x + 10, e.y - 4);
       ctx.moveTo(e.x + 28, e.y - 4); ctx.lineTo(e.x + 32, e.y - 12); ctx.lineTo(e.x + 22, e.y - 4);
       ctx.fill();
    }

    // Weapon
    ctx.save();
    ctx.translate(e.x + 16, e.y + 24);
    if (e.facing === -1) ctx.scale(-1, 1);
    
    // Swing Animation
    if (e.attackCooldown > 10) { // First 10 frames of attack
        const progress = (20 - e.attackCooldown) / 10; // 0 to 1
        ctx.rotate(progress * Math.PI/2);
        
        // Slash Effect
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.beginPath();
        ctx.arc(10, 0, 40, -Math.PI/4, Math.PI/2);
        ctx.lineTo(0,0);
        ctx.fill();
    }

    // Sword
    ctx.fillStyle = "#bdc3c7";
    ctx.fillRect(10, -10, 4, 25);
    ctx.fillStyle = "#7f8c8d";
    ctx.fillRect(6, 10, 12, 4); // Hilt
    ctx.restore();
  }

  // HP Bar
  if (e.type !== "CHEST") {
    const hpY = e.y - 16;
    ctx.fillStyle = "#333";
    ctx.fillRect(e.x, hpY, 32, 4);
    ctx.fillStyle = e.type === "PLAYER" ? "#2ecc71" : (e.type === "ROGUE_AGENT" ? "#e74c3c" : "#f39c12");
    ctx.fillRect(e.x, hpY, 32 * (Math.max(0,e.hp) / e.maxHp), 4);
    
    if (e.type === "ROGUE_AGENT") {
        ctx.fillStyle = "#e74c3c";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.fillText("ROGUE", e.x + 16, hpY - 4);
    }
  }

  ctx.restore();
};

const drawMinimap = (
  ctx: CanvasRenderingContext2D,
  platforms: Platform[],
  player: Entity,
  extractionZone: Rect | null,
  visitedChunks: Set<string>
) => {
  const MM_WIDTH = 240; // Wider
  const MM_HEIGHT = 160;
  const MM_X = CANVAS_WIDTH - MM_WIDTH - 10;
  const MM_Y = 10;
  
  // World bounds logic
  const W_W = WORLD_MAX_X - WORLD_MIN_X;
  const W_H = WORLD_MAX_Y - WORLD_MIN_Y;

  // Background
  ctx.save();
  ctx.fillStyle = "#111"; // Black void base
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(MM_X, MM_Y, MM_WIDTH, MM_HEIGHT);
  ctx.fill();
  ctx.stroke();
  ctx.clip(); 

  // Mapping Helper
  const tx = (x: number) => MM_X + ((x - WORLD_MIN_X) / W_W) * MM_WIDTH;
  const ty = (y: number) => MM_Y + ((y - WORLD_MIN_Y) / W_H) * MM_HEIGHT;
  const tw = (w: number) => (w / W_W) * MM_WIDTH;
  const th = (h: number) => (h / W_H) * MM_HEIGHT;

  // Draw ALL Platforms (Base layer)
  platforms.forEach(p => {
    ctx.fillStyle = p.type === "LAVA" ? "#e74c3c" : (p.type === "DIRT" ? "#27ae60" : "#7f8c8d");
    ctx.fillRect(tx(p.x), ty(p.y), Math.max(2, tw(p.width)), Math.max(2, th(p.height)));
  });

  // Draw Extraction Zone
  if (extractionZone) {
    ctx.fillStyle = "#9b59b6";
    ctx.beginPath();
    ctx.arc(tx(extractionZone.x + extractionZone.width/2), ty(extractionZone.y + extractionZone.height/2), 6, 0, Math.PI*2);
    ctx.fill();
    // Pulse ring
    ctx.strokeStyle = "rgba(155, 89, 182, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx(extractionZone.x + extractionZone.width/2), ty(extractionZone.y + extractionZone.height/2), 10, 0, Math.PI*2);
    ctx.stroke();
  }

  // Draw Player
  ctx.fillStyle = "#f1c40f";
  ctx.beginPath();
  ctx.arc(tx(player.x + player.width/2), ty(player.y + player.height/2), 3, 0, Math.PI*2);
  ctx.fill();

  // --- FOG OF WAR OVERLAY ---
  // Draw semi-transparent black for unvisited chunks
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)"; // 50% opacity
  for (let gx = Math.floor(WORLD_MIN_X / FOG_GRID_SIZE); gx <= Math.ceil(WORLD_MAX_X / FOG_GRID_SIZE); gx++) {
      for (let gy = Math.floor(WORLD_MIN_Y / FOG_GRID_SIZE); gy <= Math.ceil(WORLD_MAX_Y / FOG_GRID_SIZE); gy++) {
          if (!visitedChunks.has(`${gx},${gy}`)) {
              const x = gx * FOG_GRID_SIZE;
              const y = gy * FOG_GRID_SIZE;
              // Only draw if inside bounds (optimization)
              if (x + FOG_GRID_SIZE > WORLD_MIN_X && x < WORLD_MAX_X && y + FOG_GRID_SIZE > WORLD_MIN_Y && y < WORLD_MAX_Y) {
                   ctx.fillRect(tx(x), ty(y), tw(FOG_GRID_SIZE)+1, th(FOG_GRID_SIZE)+1);
              }
          }
      }
  }

  ctx.restore();
};

// --- Main App ---

const App = () => {
  const [phase, setPhase] = useState<GamePhase>("MAIN_MENU");
  const [selectedHero, setSelectedHero] = useState<HeroType>("SWORDSMAN");
  const [finalLoot, setFinalLoot] = useState<number>(0);
  const [sessionKills, setSessionKills] = useState<number>(0);
  const [win, setWin] = useState(false);
  
  // Persistent Stats
  const [totalMoney, setTotalMoney] = useState(0);
  const [totalKills, setTotalKills] = useState(0);

  const startSelection = () => setPhase("HERO_SELECT");
  const startGame = () => setPhase("PLAYING");
  
  const handleGameOver = (isWin: boolean, lootValue: number, kills: number) => {
    setWin(isWin);
    setFinalLoot(lootValue);
    setSessionKills(kills);
    
    // Update global stats
    if (isWin) {
      setTotalMoney(prev => prev + lootValue);
    }
    setTotalKills(prev => prev + kills);
    
    setPhase("RESULT");
  };

  return (
    <div style={{ 
      width: "100vw", 
      height: "100vh", 
      background: "#121212", 
      display: "flex", 
      justifyContent: "center", 
      alignItems: "center", 
      fontFamily: "Segoe UI, sans-serif",
      overflow: "hidden"
    }}>
      {phase === "MAIN_MENU" && (
        <MainMenuScreen 
          totalMoney={totalMoney} 
          totalKills={totalKills} 
          onStart={startSelection} 
        />
      )}
      {phase === "HERO_SELECT" && (
        <MenuScreen onSelect={setSelectedHero} selected={selectedHero} onStart={startGame} onBack={() => setPhase("MAIN_MENU")} />
      )}
      {phase === "PLAYING" && (
        <GameCanvas heroType={selectedHero} onGameOver={handleGameOver} />
      )}
      {phase === "RESULT" && (
        <ResultScreen win={win} loot={finalLoot} kills={sessionKills} onRestart={() => setPhase("MAIN_MENU")} />
      )}
    </div>
  );
};

// --- Components ---

const MainMenuScreen = ({ totalMoney, totalKills, onStart }: any) => {
    // Canvas for simple animated character
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const ctx = canvasRef.current?.getContext("2d");
        if(!ctx) return;
        let frame = 0;
        const draw = () => {
            ctx.clearRect(0,0, 300, 300);
            const yOffset = Math.sin(frame * 0.05) * 10;
            // Draw Giant Character
            ctx.fillStyle = "#3498db";
            ctx.fillRect(100, 100 + yOffset, 100, 140); // Body
            ctx.fillStyle = "#f1c40f";
            ctx.fillRect(90, 40 + yOffset, 120, 100); // Head
            ctx.fillStyle = "#2c3e50";
            ctx.fillRect(80, 20 + yOffset, 140, 40); // Helm
            // Sword
            ctx.save();
            ctx.translate(220, 180 + yOffset);
            ctx.rotate(-0.5);
            ctx.fillStyle = "#bdc3c7";
            ctx.fillRect(0, -100, 20, 150);
            ctx.fillRect(-20, 50, 60, 20);
            ctx.restore();
            
            frame++;
            requestAnimationFrame(draw);
        }
        draw();
    }, []);

    return (
        <div style={{ 
            color: "white", textAlign: "center", background: "linear-gradient(180deg, #1e1e1e 0%, #111 100%)", 
            padding: "40px", borderRadius: "16px", border: "1px solid #333", width: "800px", display: "flex", flexDirection: "column", alignItems: "center"
        }}>
            <h1 style={{ fontSize: "4rem", color: "#f1c40f", textShadow: "0 0 20px #f1c40f", margin: "0 0 20px 0" }}>TREASURE HUNTER</h1>
            
            <div style={{ display: "flex", justifyContent: "space-around", width: "100%", marginBottom: "30px" }}>
                 <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1rem", color: "#888", marginBottom: "5px" }}>STASH VALUE</div>
                    <div style={{ fontSize: "2.5rem", color: "#2ecc71", fontWeight: "bold" }}>${totalMoney}</div>
                 </div>
                 <canvas ref={canvasRef} width={300} height={300} style={{ margin: "-50px 0" }} />
                 <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1rem", color: "#888", marginBottom: "5px" }}>ROGUES ELIMINATED</div>
                    <div style={{ fontSize: "2.5rem", color: "#e74c3c", fontWeight: "bold" }}>💀 {totalKills}</div>
                 </div>
            </div>

            <button onClick={onStart} style={{
                background: "#e67e22", border: "4px solid #d35400", padding: "20px 80px", fontSize: "2rem", 
                color: "white", borderRadius: "12px", cursor: "pointer", fontWeight: "bold",
                boxShadow: "0 5px 0 #d35400, 0 10px 20px rgba(0,0,0,0.5)", transform: "translateY(-4px)",
                transition: "transform 0.1s"
            }}>START GAME</button>
        </div>
    );
};

const MenuScreen = ({ onSelect, selected, onStart, onBack }: any) => (
  <div style={{ 
    color: "white", textAlign: "center", background: "#1e1e1e", padding: "40px", 
    borderRadius: "16px", border: "1px solid #333", maxWidth: "600px", zIndex: 10
  }}>
    <h2 style={{ fontSize: "2rem", color: "#fff", marginBottom: "30px" }}>CHOOSE YOUR HERO</h2>

    <div style={{ display: "flex", gap: "20px", justifyContent: "center", marginBottom: "40px" }}>
      <HeroCard type="SWORDSMAN" selected={selected === "SWORDSMAN"} onClick={() => onSelect("SWORDSMAN")} />
      <HeroCard type="MAGE" selected={selected === "MAGE"} onClick={() => onSelect("MAGE")} />
    </div>

    <div style={{ display: "flex", gap: "20px", justifyContent: "center" }}>
        <button onClick={onBack} style={{
        background: "transparent", border: "2px solid #555", padding: "16px 32px", fontSize: "1.2rem", 
        color: "#aaa", borderRadius: "8px", cursor: "pointer", fontWeight: "bold"
        }}>BACK</button>
        
        <button onClick={onStart} style={{
        background: "#27ae60", border: "2px solid #27ae60", padding: "16px 48px", fontSize: "1.4rem", 
        color: "white", borderRadius: "8px", cursor: "pointer", fontWeight: "bold"
        }}>DEPLOY</button>
    </div>
  </div>
);

const HeroCard = ({ type, selected, onClick }: any) => (
  <div onClick={onClick} style={{
    width: "180px", padding: "20px", background: selected ? "#2c3e50" : "#222",
    border: `3px solid ${selected ? "#3498db" : "#444"}`, borderRadius: "12px", cursor: "pointer",
    transform: selected ? "scale(1.05)" : "scale(1)", transition: "all 0.2s"
  }}>
    <div style={{ fontSize: "3rem", marginBottom: "10px" }}>{type === "SWORDSMAN" ? "⚔️" : "🔮"}</div>
    <h3>{type}</h3>
    <div style={{ fontSize: "0.8rem", color: "#aaa", marginTop: "10px" }}>
      {type === "SWORDSMAN" ? "High HP. Whirlwind." : "Ranged. Meteor."}
    </div>
  </div>
);

const GameCanvas = ({ heroType, onGameOver }: { heroType: HeroType, onGameOver: (w: boolean, l: number, k: number) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // React State for UI
  const [inventory, setInventory] = useState<Item[]>([]);
  const [potionCount, setPotionCount] = useState(0);
  const [lootModal, setLootModal] = useState<Item | null>(null);
  const [readingProgress, setReadingProgress] = useState<number>(0);
  const [promptVisible, setPromptVisible] = useState(false);
  const [extractionTimer, setExtractionTimer] = useState(0);

  // Game Logic Refs (Mutable state that doesn't trigger re-renders)
  const inventoryRef = useRef<Item[]>([]);
  const potionRef = useRef(0);
  const playerRef = useRef<Entity | null>(null);
  const entitiesRef = useRef<Entity[]>([]);
  const platformsRef = useRef<Platform[]>([]);
  const textsRef = useRef<FloatingText[]>([]);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const killsRef = useRef(0);
  const visitedChunksRef = useRef<Set<string>>(new Set());
  
  const stateRef = useRef({
    time: 0,
    cameraX: 0,
    cameraY: 0,
    extractionActive: false,
    extractionZone: null as Rect | null, 
    gameOver: false,
    readingTimer: 0,
    interactionTarget: null as Entity | null,
    extractionFrameCount: 0,
    isReading: false,
    isLootMenuOpen: false
  });

  const PLAYER_COLOR = heroType === "SWORDSMAN" ? "#3498db" : "#9b59b6";
  const INVENTORY_CAP = 20;

  // --- Map Generation (Hollow Knight / Metroidvania Style) ---
  const generateMap = () => {
    const plats: Platform[] = [];
    const addRect = (x: number, y: number, w: number, h: number, type: PlatformType) => {
        plats.push({ x, y, width: w, height: h, type });
    };

    // --- 1. THE VERTICAL SHAFT (The "Well") ---
    // A central spine allowing vertical movement
    // x = -200 to 200. y = -1000 to 1000
    for (let y = -1000; y < 1000; y += 200) {
        // Staggered ledges
        addRect(y % 400 === 0 ? -250 : 150, y, 120, 20, "STONE");
    }
    
    // --- 2. FORGOTTEN CROSSROADS (The Horizontal Main Layer) ---
    // y = 800. Spans wide. The main thoroughfare.
    addRect(-1500, 800, 1000, 60, "DIRT"); // West Side
    addRect(-500, 800, 1000, 60, "DIRT");  // Center Side
    addRect(500, 800, 1000, 60, "DIRT");   // East Side
    
    // --- 3. UPPER CHAMBERS (Ancestral Mound Style) ---
    // Top Left Room (Enclosed feeling)
    addRect(-1200, -200, 600, 40, "STONE");
    addRect(-1200, -600, 200, 20, "WOOD"); // Higher platform inside "mound"
    addRect(-1000, -400, 200, 20, "WOOD");
    
    // Top Right Room
    addRect(800, -200, 600, 40, "STONE");
    
    // Far Top Surface (Town)
    addRect(-600, -1200, 1200, 60, "DIRT");

    // --- 4. LOWER CHAMBERS (The Depths) ---
    // Below y = 800
    addRect(-800, 1400, 1600, 60, "STONE"); // Boss Arena logic / Deep storage
    
    // --- 5. CONNECTORS & TUNNELS ---
    // Steps going down from Main Layer (y=800) to Depths (y=1400)
    addRect(-1000, 1000, 100, 20, "WOOD");
    addRect(-800, 1200, 100, 20, "WOOD");
    addRect(800, 1000, 100, 20, "WOOD");
    addRect(1000, 1200, 100, 20, "WOOD");

    // Steps going up to Upper Chambers
    addRect(-800, 300, 100, 20, "WOOD");
    addRect(-800, 550, 100, 20, "WOOD");
    
    addRect(800, 300, 100, 20, "WOOD");
    addRect(800, 550, 100, 20, "WOOD");

    // --- 6. LAVA PITS (Hazards) ---
    // West end of Crossroads
    addRect(-2000, 820, 500, 20, "LAVA"); 
    // East end of Crossroads
    addRect(1500, 820, 500, 20, "LAVA");
    // Deep pit center
    addRect(-200, 1450, 400, 20, "LAVA");

    // --- BEDROCK (Safety) ---
    addRect(-10000, 2000, 20000, 500, "STONE");
    
    // START PLATFORM (Center of Map)
    addRect(-200, 0, 400, 40, "DIRT"); 

    return plats;
  };

  const generateLoot = (): Item => {
    const r = Math.random();
    let rarity: LootRarity = "COMMON";
    if (r > 0.99) rarity = "MYTHIC";
    else if (r > 0.9) rarity = "LEGENDARY";
    else if (r > 0.6) rarity = "EPIC";

    const config = RARITY_CONFIG[rarity];
    const value = Math.floor(Math.random() * (config.max - config.min) + config.min);
    const types = ["Coin", "Gem", "Chalice", "Relic", "Crown", "Artifact"];
    const name = `${rarity} ${types[Math.floor(Math.random() * types.length)]}`;

    return {
      id: Math.random(), name, rarity, value, color: config.color
    };
  };

  const handlePickup = () => {
    if (inventoryRef.current.length < INVENTORY_CAP && lootModal) {
      inventoryRef.current.push(lootModal);
      setInventory([...inventoryRef.current]);
    }
    setLootModal(null);
    stateRef.current.isLootMenuOpen = false;
  };

  const handleDiscard = () => {
    setLootModal(null);
    stateRef.current.isLootMenuOpen = false;
  };

  // Keyboard listener for Modal specific actions
  useEffect(() => {
    const handleModalKeys = (e: KeyboardEvent) => {
      if (lootModal) {
        if (e.code === "KeyJ") handlePickup();
        if (e.code === "KeyK") handleDiscard();
      }
    };
    window.addEventListener("keydown", handleModalKeys);
    return () => window.removeEventListener("keydown", handleModalKeys);
  }, [lootModal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // --- INIT GAME STATE ---
    platformsRef.current = generateMap();
    killsRef.current = 0;
    visitedChunksRef.current.clear();
    potionRef.current = 0;
    setPotionCount(0);

    // Player Spawn (Centered on Start Platform)
    playerRef.current = {
      id: 0, type: "PLAYER", x: 0, y: -100, width: 32, height: 48,
      vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1,
      attackCooldown: 0, hitFlashTimer: 0, skillCooldown: 0, isDead: false, color: PLAYER_COLOR,
      jumpCount: 0, isJumpKeyHeld: false
    };

    // Entity Spawner
    const entities: Entity[] = [];
    platformsRef.current.forEach(p => {
        // More chests for bigger map
        if (p.type !== "LAVA" && p.type !== "WOOD" && Math.random() > 0.2) {
             entities.push({
                id: Math.random(), type: "CHEST",
                x: p.x + p.width/2 - 16, y: p.y - 32,
                width: 32, height: 32, vx: 0, vy: 0, hp: 1, maxHp: 1, facing: 1,
                attackCooldown: 0, hitFlashTimer: 0, isDead: false, color: "gold", isOpened: false,
                jumpCount: 0, isJumpKeyHeld: false
             });
        }
    });
    entitiesRef.current = entities;

    // Listeners
    const handleKeyDown = (e: KeyboardEvent) => keysRef.current[e.code] = true;
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current[e.code] = false;
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    let animationId: number;

    const loop = () => {
      if (stateRef.current.gameOver) return;
      const p = playerRef.current;
      if (!p) return;

      // Always update time and entities (World doesn't pause)
      stateRef.current.time++;
      const { time } = stateRef.current;

      // --- EXPLORATION LOGIC ---
      const gridX = Math.floor(p.x / FOG_GRID_SIZE);
      const gridY = Math.floor(p.y / FOG_GRID_SIZE);
      // Mark current and adjacent chunks as visited
      for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
              visitedChunksRef.current.add(`${gridX + dx},${gridY + dy}`);
          }
      }

      // --- SPAWN LOGIC ---
      if (time % 200 === 0 && entitiesRef.current.length < 50) {
          const spawnX = p.x + (Math.random() > 0.5 ? 600 : -600);
          const type = Math.random() > 0.7 ? "MOB_BAT" : "MOB_SLIME";
          entitiesRef.current.push({
              id: Math.random(), type: type as EntityType,
              x: spawnX, y: p.y - 100, width: 32, height: 32,
              vx: 0, vy: 0, hp: 30, maxHp: 30, facing: 1,
              attackCooldown: 0, hitFlashTimer: 0, isDead: false, color: "#2ecc71",
              jumpCount: 0, isJumpKeyHeld: false
          });
      }
      
      const rogueCount = entitiesRef.current.filter(e => e.type === "ROGUE_AGENT" && !e.isDead).length;
      if (time % 1200 === 0 && rogueCount < 5) { // Cap of 5 Rogues
            entitiesRef.current.push({
              id: Math.random(), type: "ROGUE_AGENT",
              x: p.x + 500, y: p.y - 100, width: 32, height: 48,
              vx: 0, vy: 0, hp: 120, maxHp: 120, 
              facing: -1,
              attackCooldown: 0, hitFlashTimer: 0, isDead: false, color: "#c0392b",
              jumpCount: 0, isJumpKeyHeld: false, jumpCooldown: 0
            });
            textsRef.current.push({id: Math.random(), x: p.x, y: p.y - 100, text: "⚠️ ROGUE AGENT DETECTED!", color: "#e74c3c", life: 120, vy: -0.5});
      }

      // --- PLAYER PHYSICS ---
      if (!stateRef.current.isLootMenuOpen) {
          const moveForce = 0.8;
          let didMove = false;
          if (keysRef.current["KeyA"] || keysRef.current["ArrowLeft"]) { p.vx -= moveForce; p.facing = -1; didMove = true; }
          if (keysRef.current["KeyD"] || keysRef.current["ArrowRight"]) { p.vx += moveForce; p.facing = 1; didMove = true; }
          
          // JUMP LOGIC (Double Jump)
          const isJumpPressed = keysRef.current["Space"] || keysRef.current["ArrowUp"] || keysRef.current["KeyW"];
          
          if (isJumpPressed) {
              if (!p.isJumpKeyHeld) {
                  // Rising edge of jump key
                  if (p.jumpCount < 2) {
                      p.vy = JUMP_FORCE;
                      p.jumpCount++;
                      // Visual effect for double jump
                      if (p.jumpCount === 2) {
                          textsRef.current.push({id: Math.random(), x: p.x, y: p.y + p.height, text: "💨", color: "#fff", life: 20, vy: 0});
                      }
                      didMove = true;
                  }
                  p.isJumpKeyHeld = true;
              }
          } else {
              p.isJumpKeyHeld = false;
          }

          // Potion Usage
          if (keysRef.current["Digit1"]) {
              if (potionRef.current > 0 && p.hp < p.maxHp) {
                  potionRef.current--;
                  setPotionCount(potionRef.current);
                  const healAmount = Math.floor(p.maxHp * 0.3);
                  p.hp = Math.min(p.hp + healAmount, p.maxHp);
                  textsRef.current.push({id: Math.random(), x: p.x, y: p.y - 20, text: `+${healAmount} HP`, color: "#2ecc71", life: 40, vy: -1});
                  
                  // Simple debounce hack by clearing key immediately (or assume user lifts key)
                  // Ideally we track key press state, but for now relying on natural key repeat delay or quick tap
                  keysRef.current["Digit1"] = false; 
              }
          }

          // Search Interaction
          const chest = entitiesRef.current.find(e => e.type === "CHEST" && !e.isDead && !e.isOpened && getDistance(p, e) < 100);
          stateRef.current.interactionTarget = chest || null;
          setPromptVisible(!!chest);

          if (stateRef.current.isReading && didMove) {
              stateRef.current.isReading = false;
              stateRef.current.readingTimer = 0;
              setReadingProgress(0);
          }
          if (keysRef.current["KeyH"] && chest && !stateRef.current.isReading) {
              stateRef.current.isReading = true;
          }
      }

      p.vx *= FRICTION;
      p.vy += GRAVITY;
      p.x += p.vx;
      p.y += p.vy;

      // --- COLLISION RESOLUTION ---
      let onGround = false;
      platformsRef.current.forEach(plat => {
          if (rectIntersect(p, plat)) {
              if (plat.type === "LAVA") {
                  // Instant Death logic
                  p.hp = 0;
                  textsRef.current.push({id: Math.random(), x: p.x, y: p.y - 50, text: "MELTED!", color: "#e74c3c", life: 60, vy: -1});
                  return;
              }

              const overlapY = (p.y + p.height) - plat.y;
              if (p.vy >= 0 && overlapY <= 20 && overlapY >= 0) {
                  p.y = plat.y - p.height;
                  p.vy = 0;
                  onGround = true;
                  p.jumpCount = 0; // Reset jumps on landing
              } else if (p.vy < 0 && p.y < plat.y + plat.height && p.y > plat.y) {
                  p.y = plat.y + plat.height;
                  p.vy = 0;
              }
          }
      });

      // Reading Logic
      if (stateRef.current.isReading && stateRef.current.interactionTarget) {
          stateRef.current.readingTimer++;
          const progress = (stateRef.current.readingTimer / 90) * 100;
          setReadingProgress(progress);
          
          if (stateRef.current.readingTimer >= 90) {
              const chest = stateRef.current.interactionTarget;
              chest.isOpened = true;
              stateRef.current.isLootMenuOpen = true;
              stateRef.current.isReading = false;
              stateRef.current.readingTimer = 0;
              setReadingProgress(0);
              
              // Chest Loot Logic
              setLootModal(generateLoot());
              
              // Potion Drop Chance (40%)
              if (Math.random() < 0.4) {
                  potionRef.current++;
                  setPotionCount(potionRef.current);
                  textsRef.current.push({id: Math.random(), x: p.x, y: p.y - 60, text: "+1 POTION", color: "#e74c3c", life: 60, vy: -0.5});
              }
          }
      } else if (!stateRef.current.isReading) {
          setReadingProgress(0);
      }

      // --- COMBAT LOGIC ---
      if (!stateRef.current.isLootMenuOpen) {
          // Attack (J)
          if (keysRef.current["KeyJ"] && p.attackCooldown <= 0) {
              p.attackCooldown = 20; 
              const reach = 120;
              const hitBox = { 
                  x: p.facing === 1 ? p.x + p.width : p.x - reach, 
                  y: p.y - 10, width: reach, height: p.height + 20
              };
              entitiesRef.current.forEach(e => {
                  if ((e.type === "MOB_SLIME" || e.type === "MOB_BAT" || e.type === "ROGUE_AGENT") && !e.isDead) {
                      if (rectIntersect(hitBox, e)) {
                          e.hp -= 20;
                          e.hitFlashTimer = 5;
                          // Enhanced Knockback
                          const kDir = p.facing;
                          e.vx = kDir * 15;
                          e.vy = -6;
                          textsRef.current.push({id: Math.random(), x: e.x, y: e.y, text: "20", color: "#fff", life: 30, vy: -2});
                          
                          if (e.hp <= 0 && e.type === "ROGUE_AGENT") {
                              killsRef.current++;
                          }
                      }
                  }
              });
          }

          // Skill (K)
          if (keysRef.current["KeyK"] && (p.skillCooldown || 0) <= 0) {
              p.skillCooldown = 180;
              textsRef.current.push({id: Math.random(), x: p.x, y: p.y - 50, text: heroType === "SWORDSMAN" ? "WHIRLWIND!" : "METEOR!", color: "#f1c40f", life: 50, vy: -1});
              
              if (heroType === "SWORDSMAN") {
                  const radius = 150;
                  entitiesRef.current.forEach(e => {
                      if ((e.type === "MOB_SLIME" || e.type === "MOB_BAT" || e.type === "ROGUE_AGENT") && !e.isDead) {
                          if (getDistance(p, e) < radius) {
                              e.hp -= 40;
                              e.hitFlashTimer = 10;
                              e.vx = (e.x - p.x > 0 ? 1 : -1) * 20; // Massive knockback
                              e.vy = -10;
                              textsRef.current.push({id: Math.random(), x: e.x, y: e.y, text: "40", color: "#f1c40f", life: 40, vy: -2});
                              if (e.hp <= 0 && e.type === "ROGUE_AGENT") {
                                killsRef.current++;
                              }
                          }
                      }
                  });
              } else {
                  const targetX = p.x + (p.facing * 250);
                  const radius = 120;
                  entitiesRef.current.forEach(e => {
                      if ((e.type === "MOB_SLIME" || e.type === "MOB_BAT" || e.type === "ROGUE_AGENT") && !e.isDead) {
                          const dist = Math.sqrt(Math.pow(e.x - targetX, 2) + Math.pow(e.y - p.y, 2));
                          if (dist < radius) {
                              e.hp -= 60;
                              e.hitFlashTimer = 10;
                              e.vy = -12;
                              textsRef.current.push({id: Math.random(), x: e.x, y: e.y, text: "60", color: "#9b59b6", life: 40, vy: -2});
                              if (e.hp <= 0 && e.type === "ROGUE_AGENT") {
                                killsRef.current++;
                              }
                          }
                      }
                  });
              }
          }
      }
      if (p.attackCooldown > 0) p.attackCooldown--;
      if (p.hitFlashTimer > 0) p.hitFlashTimer--;
      if (p.skillCooldown && p.skillCooldown > 0) p.skillCooldown--;

      // --- ENTITY LOOP ---
      entitiesRef.current.forEach(e => {
          if (e.isDead || e.type === "CHEST") return;
          
          if (e.type !== "MOB_BAT") e.vy += GRAVITY;
          e.x += e.vx;
          e.y += e.vy;
          e.vx *= FRICTION;
          
          let entityOnGround = false;
          platformsRef.current.forEach(plat => {
                if (rectIntersect(e, plat)) {
                    if (plat.type === "LAVA") {
                        if (e.type !== "MOB_BAT") e.hp = 0; 
                    } else if (e.vy > 0 && (e.y + e.height) - plat.y <= 20) {
                        e.y = plat.y - e.height;
                        e.vy = 0;
                        entityOnGround = true;
                    }
                }
          });

          if (e.hitFlashTimer > 0) e.hitFlashTimer--;
          if (e.jumpCooldown && e.jumpCooldown > 0) e.jumpCooldown--;

          // AI Aggro
          const dist = getDistance(e, p);
          if (dist < 800) { 
                const dx = p.x - e.x;
                const dy = p.y - e.y;
                let dir = dx > 0 ? 1 : -1;
                
                if (e.type === "ROGUE_AGENT") {
                    let moveSpeed = 0.5; // NERF: Slowed down from 0.8 to 0.5
                    if (e.attackCooldown > 0 && dist < 120) {
                        dir *= -1;
                        moveSpeed = 0.3; // Slower retreat
                    }

                    e.vx += dir * moveSpeed;
                    
                    // NERF: Max Speed Cap reduced from 5 to 2.5
                    if (e.vx > 2.5) e.vx = 2.5;
                    if (e.vx < -2.5) e.vx = -2.5;

                    e.facing = (dx > 0 ? 1 : -1) as 1|-1;

                    // Rogue Jump Logic
                    if ((e.jumpCooldown || 0) <= 0 && entityOnGround) {
                        // Jump if target is significantly above
                        if (dy < -60) {
                             e.vy = JUMP_FORCE; // Same force as player
                             e.jumpCooldown = 60; // 1s cooldown
                        }
                        // Jump if stuck against a wall
                        else if (Math.abs(e.vx) < 1 && Math.abs(dx) > 30) {
                             e.vy = JUMP_FORCE;
                             e.jumpCooldown = 60;
                        }
                    }
                    
                    if (dist < 60 && e.attackCooldown <= 0) {
                        e.attackCooldown = 45; 
                        // NERF: Damage reduced from 12 to 6
                        p.hp -= 6; 
                        p.hitFlashTimer = 5;
                        p.vx = (p.x > e.x ? 1 : -1) * 10;
                        textsRef.current.push({id: Math.random(), x: p.x, y: p.y, text: "-6", color: "#e74c3c", life: 40, vy: -1});
                    }
                } else if (e.type === "MOB_SLIME") {
                    e.vx += dir * 0.2;
                    e.facing = dir as 1|-1;
                    if (dist < 40 && rectIntersect(e, p)) {
                      p.hp -= 0.2;
                    }
                } else if (e.type === "MOB_BAT") {
                    e.vx += dir * 0.3;
                    e.vy += (dy > 0 ? 1 : -1) * 0.1; 
                    e.vy *= 0.9; 
                }
          }
          
          if (e.attackCooldown > 0) e.attackCooldown--;
          if (e.hp <= 0) e.isDead = true;
      });

      // --- GAME END ---
      if (p.hp <= 0) {
          stateRef.current.gameOver = true;
          onGameOver(false, 0, killsRef.current);
      }

      // --- EXTRACTION ---
      if (time === 1800) {
            stateRef.current.extractionActive = true;
            // Find a valid platform for extraction point
            const validPlats = platformsRef.current.filter(plat => plat.type !== "LAVA" && plat.type !== "WOOD");
            const targetPlat = validPlats[Math.floor(Math.random() * validPlats.length)];
            
            // Define point (80x100 portal)
            stateRef.current.extractionZone = { 
                x: targetPlat.x + targetPlat.width/2 - 40, 
                y: targetPlat.y - 100, 
                width: 80, 
                height: 100 
            };
            
            textsRef.current.push({id: Math.random(), x: p.x, y: p.y - 150, text: `PORTAL OPENED! CHECK MAP!`, color: "#9b59b6", life: 300, vy: 0});
      }

      if (stateRef.current.extractionActive && stateRef.current.extractionZone) {
          const zone = stateRef.current.extractionZone;
          if (rectIntersect(p, zone)) {
                stateRef.current.extractionFrameCount++;
                setExtractionTimer(Math.floor(stateRef.current.extractionFrameCount));
                
                if (stateRef.current.extractionFrameCount > 180) { // 3 seconds (60fps * 3)
                    stateRef.current.gameOver = true;
                    const total = inventoryRef.current.reduce((a, b) => a + b.value, 0);
                    onGameOver(true, total, killsRef.current);
                }
          } else {
              stateRef.current.extractionFrameCount = 0;
              setExtractionTimer(0);
          }
      }

      // --- DRAWING ---
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const targetCamX = p.x - CANVAS_WIDTH/2;
      const targetCamY = p.y - CANVAS_HEIGHT/2;
      stateRef.current.cameraX += (targetCamX - stateRef.current.cameraX) * 0.1;
      stateRef.current.cameraY += (targetCamY - stateRef.current.cameraY) * 0.1;
      
      const cx = stateRef.current.cameraX;
      const cy = stateRef.current.cameraY;

      ctx.save();
      ctx.translate(-cx, -cy);

      ctx.fillStyle = "#222";
      ctx.fillRect(cx, cy + 200, CANVAS_WIDTH, CANVAS_HEIGHT); 

      // Draw Platforms & Lava
      platformsRef.current.forEach(plat => drawPlatform(ctx, plat, time));

      // Extraction Zone (Portal)
      if (stateRef.current.extractionActive && stateRef.current.extractionZone) {
         const z = stateRef.current.extractionZone;
         
         // Swirling Portal Effect
         const angle = (time * 0.05) % (Math.PI * 2);
         ctx.save();
         ctx.translate(z.x + z.width/2, z.y + z.height/2);
         ctx.rotate(angle);
         
         ctx.fillStyle = "rgba(142, 68, 173, 0.6)";
         ctx.beginPath();
         ctx.rect(-z.width/2, -z.height/2, z.width, z.height);
         ctx.fill();
         
         // Inner
         ctx.rotate(angle * -2);
         ctx.fillStyle = "rgba(44, 62, 80, 0.8)";
         ctx.beginPath();
         ctx.rect(-20, -20, 40, 40);
         ctx.fill();
         
         ctx.restore();

         // Text
         ctx.fillStyle = "#fff";
         ctx.font = "bold 14px Arial";
         ctx.fillText("EXIT", z.x + 25, z.y - 10);
         
         // Beam
         ctx.fillStyle = "rgba(155, 89, 182, 0.2)";
         ctx.fillRect(z.x, z.y - 1000, z.width, 1000);
      }

      entitiesRef.current.forEach(e => {
         if (!e.isDead) drawEntity(ctx, e, false);
      });
      drawEntity(ctx, p, true);

      // Skill Effects
      if ((p.skillCooldown || 0) > 170) {
          if (heroType === "SWORDSMAN") {
              ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
              ctx.beginPath();
              ctx.arc(p.x + p.width/2, p.y + p.height/2, 150, 0, Math.PI*2);
              ctx.fill();
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 5;
              ctx.stroke();
          } else {
              const tx = p.x + p.facing * 250;
              ctx.fillStyle = "rgba(241, 196, 15, 0.5)";
              ctx.beginPath();
              ctx.arc(tx, p.y, 100, 0, Math.PI*2);
              ctx.fill();
          }
      }

      textsRef.current.forEach(t => {
         ctx.fillStyle = t.color;
         ctx.font = "bold 20px Arial";
         ctx.fillText(t.text, t.x, t.y);
         t.y += t.vy;
         t.life--;
      });
      textsRef.current = textsRef.current.filter(t => t.life > 0);

      ctx.restore();

      // --- MINIMAP ---
      drawMinimap(ctx, platformsRef.current, p, stateRef.current.extractionZone, visitedChunksRef.current);

      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []); 

  return (
    <div style={{ position: "relative" }}>
      <canvas 
        ref={canvasRef} 
        width={CANVAS_WIDTH} 
        height={CANVAS_HEIGHT} 
        style={{ border: "4px solid #333", borderRadius: "4px", background: "#0d0d0d" }} 
      />
      
      {/* HUD - Inventory */}
      <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: "10px" }}>
        <div style={{ background: "rgba(0,0,0,0.8)", padding: "10px", borderRadius: "8px", color: "white", border: "1px solid #444" }}>
          <div style={{ fontSize: "12px", color: "#aaa" }}>BAG ({inventory.length}/{INVENTORY_CAP})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px", marginTop: "5px" }}>
            {Array.from({ length: INVENTORY_CAP }).map((_, i) => (
              <div key={i} style={{ 
                width: "24px", height: "24px", 
                background: inventory[i] ? inventory[i].color : "#222",
                border: "1px solid #444",
                boxShadow: inventory[i] ? `0 0 5px ${inventory[i].color}` : "none"
              }} title={inventory[i]?.name} />
            ))}
          </div>
          <div style={{ marginTop: "5px", fontSize: "14px", color: "#f1c40f", fontWeight: "bold" }}>
            {inventory.reduce((a, b) => a + b.value, 0)}g
          </div>
        </div>
      </div>

      {/* HUD - Potions (Bottom Left) */}
      <div style={{ 
          position: "absolute", bottom: 10, left: 10, 
          background: "rgba(0,0,0,0.8)", padding: "10px", borderRadius: "8px", 
          border: "1px solid #e74c3c", display: "flex", alignItems: "center", gap: "10px", color: "white" 
      }}>
          <div style={{ fontSize: "2rem" }}>🧪</div>
          <div>
              <div style={{ fontWeight: "bold", fontSize: "1.2rem", color: "#e74c3c" }}>x {potionCount}</div>
              <div style={{ fontSize: "0.8rem", color: "#aaa" }}>PRESS [1] TO HEAL</div>
          </div>
      </div>

      {/* Controls Help (Moved Down) */}
      <div style={{ 
        position: "absolute", top: 170, right: 10, 
        background: "rgba(0,0,0,0.6)", padding: "10px", borderRadius: "8px", 
        color: "#ccc", fontSize: "12px", fontFamily: "monospace" 
      }}>
        <div>W / SPACE : JUMP (x2)</div>
        <div>A / D     : MOVE</div>
        <div>J         : ATTACK</div>
        <div>K         : SKILL</div>
        <div>H         : SEARCH BOX</div>
        <div>1         : USE POTION</div>
      </div>

      {/* Interaction Prompts */}
      {promptVisible && !lootModal && (
        <div style={{ 
          position: "absolute", top: "40%", left: "50%", transform: "translate(-50%, -50%)",
          pointerEvents: "none"
        }}>
          <div style={{ 
            background: "rgba(0,0,0,0.7)", padding: "8px 16px", borderRadius: "20px", 
            border: "2px solid #fff", color: "white", fontWeight: "bold" 
          }}>
            PRESS [H] TO SEARCH
          </div>
          {readingProgress > 0 && (
             <div style={{ width: "150px", height: "10px", background: "#333", marginTop: "10px", borderRadius: "5px" }}>
                <div style={{ width: `${readingProgress}%`, height: "100%", background: "#f1c40f", borderRadius: "5px" }} />
             </div>
          )}
        </div>
      )}

      {/* Extraction UI */}
      {extractionTimer > 0 && (
        <div style={{ 
            position: "absolute", top: "20%", left: "50%", transform: "translate(-50%, -50%)",
            color: "#9b59b6", fontSize: "2rem", fontWeight: "bold", textShadow: "0 0 10px #000"
        }}>
           EXTRACTING... {(3 - extractionTimer/60).toFixed(1)}s
        </div>
      )}

      {/* Loot Modal */}
      {lootModal && (
        <div style={{ 
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0, 
          background: "rgba(0,0,0,0.8)", display: "flex", justifyContent: "center", alignItems: "center" 
        }}>
          <div style={{ 
            background: "#2c3e50", padding: "40px", borderRadius: "16px", 
            border: `4px solid ${lootModal.color}`, textAlign: "center", color: "white",
            boxShadow: `0 0 50px ${lootModal.color}`
          }}>
            <div style={{ fontSize: "1.5rem", color: "#aaa", marginBottom: "10px" }}>YOU FOUND</div>
            <h1 style={{ fontSize: "3rem", margin: "10px 0", color: lootModal.color }}>{lootModal.name}</h1>
            <div style={{ fontSize: "2rem", color: "#f1c40f", marginBottom: "30px" }}>Value: {lootModal.value}g</div>
            
            <div style={{ display: "flex", gap: "20px" }}>
              <div style={{ padding: "10px 20px", background: "#c0392b", borderRadius: "8px" }}>
                [K] DISCARD
              </div>
              <div style={{ padding: "10px 20px", background: "#27ae60", borderRadius: "8px" }}>
                [J] TAKE
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ResultScreen = ({ win, loot, kills, onRestart }: any) => (
  <div style={{ 
    color: "white", textAlign: "center", background: "#1e1e1e", padding: "50px", 
    borderRadius: "16px", border: win ? "4px solid #2ecc71" : "4px solid #e74c3c"
  }}>
    <h1 style={{ fontSize: "4rem", color: win ? "#2ecc71" : "#e74c3c", margin: 0 }}>
      {win ? "EXTRACTION SUCCESS" : "MIA / KILLED"}
    </h1>
    <div style={{ fontSize: "1.5rem", margin: "20px 0", color: "#aaa" }}>
      {win ? "You secured the loot!" : "All equipment lost."}
    </div>
    
    <div style={{ display: "flex", justifyContent: "center", gap: "40px", margin: "40px 0" }}>
       <div>
         <div style={{ fontSize: "1rem", color: "#888" }}>LOOT VALUE</div>
         <div style={{ fontSize: "3rem", color: "#f1c40f" }}>{win ? loot : 0}</div>
       </div>
       <div>
         <div style={{ fontSize: "1rem", color: "#888" }}>ROGUES KILLED</div>
         <div style={{ fontSize: "3rem", color: "#e74c3c" }}>{kills}</div>
       </div>
    </div>

    <button onClick={onRestart} style={{
      background: "#3498db", border: "none", padding: "16px 48px", fontSize: "1.5rem", 
      color: "white", borderRadius: "8px", cursor: "pointer", fontWeight: "bold"
    }}>RETURN TO BASE</button>
  </div>
);

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
