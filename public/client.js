const socket = io();
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

let playerId = null;
let players = {};
let bullets = [];
let walls = [];
let keys = {};
let mouse = { x: 0, y: 0 };
let smokeParticles = [];
let playerName = null;
let showStats = false;
let drawLoopStarted = false;  // Pour éviter plusieurs boucles
let sendInputInterval = null; // Pour éviter plusieurs setInterval
let shooting = false;
let shootInterval = null;

// Slash effects : objets { x, y, angle, time, maxTime, playerId }
let slashEffects = [];

// Gestion clavier
document.addEventListener("keydown", e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "r") socket.emit("reload");
  if (e.key === "Shift") socket.emit("dash");
  if (e.key === "Tab") {
    e.preventDefault();
    showStats = true;
  }
  if (e.key === " ") socket.emit("slash");
});

document.addEventListener("keyup", e => {
  keys[e.key.toLowerCase()] = false;
  if (e.key === "Tab") showStats = false;
});

// Souris
canvas.addEventListener("mousemove", e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

canvas.addEventListener("mousedown", () => {
  if (!shooting) {
    shooting = true;
    socket.emit("shoot"); // Premier tir immédiat
    shootInterval = setInterval(() => {
      socket.emit("shoot");
    }, 150); // tir toutes les 150ms, ajuste à ton gameplay
  }
});

canvas.addEventListener("mouseup", () => {
  shooting = false;
  clearInterval(shootInterval);
});

// Dessins
function drawPlayer(p, offsetX, offsetY) {
  if (p.dead) return;

  ctx.save();
  ctx.translate(p.x + offsetX, p.y + offsetY);
  ctx.rotate(p.angle);
  ctx.fillStyle = p.id === playerId ? "#72c2ff" : "#e74c3c";
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(30, 0);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(p.x + offsetX - 20, p.y + offsetY - 30, 40, 6);
  ctx.fillStyle = "#e74c3c";
  ctx.fillRect(p.x + offsetX - 20, p.y + offsetY - 30, 40 * (p.health / 100), 6);

  ctx.fillStyle = "white";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(p.name || "Anonymous", p.x + offsetX, p.y + offsetY + 35);

  // Cercle de rechargement autour du joueur
if (p.reloading && p.reloadStartTime) {
  const reloadDuration = 2000; // 2 secondes
  const elapsed = performance.now() - p.reloadStartTime;
  const progress = Math.min(elapsed / reloadDuration, 1);

  ctx.save();
  ctx.translate(p.x + offsetX, p.y + offsetY);
  ctx.beginPath();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.arc(0, 0, 14, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}
  
}

function drawStats() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillRect(50, 50, 400, 500);

  ctx.fillStyle = "#fff";
  ctx.font = "20px sans-serif";
  ctx.fillText("Classement des joueurs", 70, 80);

  const sortedPlayers = Object.values(players).sort((a, b) => b.kills - a.kills);
  ctx.font = "16px sans-serif";
  let y = 120;
  sortedPlayers.forEach((p, i) => {
    const isLocal = p.id === playerId;
    ctx.fillStyle = isLocal ? "#72c2ff" : "#fff";
    const name = p.name || "Joueur";
    ctx.fillText(`${i + 1}. ${name} - Kills: ${p.kills} | Morts: ${p.deaths}`, 70, y);
    y += 28;
  });
}

function drawSmoke(offsetX, offsetY) {
  smokeParticles = smokeParticles.filter(s => s.alpha > 0);
  smokeParticles.forEach(s => {
    s.alpha -= 0.008;
    s.x += (Math.random() - 0.5) * 0.4;
    s.y += (Math.random() - 0.5) * 0.4;
    ctx.fillStyle = `rgba(180,180,180,${s.alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(s.x + offsetX, s.y + offsetY, s.radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Effet slash 360° (cercle + lames tournantes)
function drawKnifeSlashEffect(x, y, time, maxTime, offsetX, offsetY) {
  const halfTime = maxTime / 2;
  let progress;
  if (time <= halfTime) {
    // Aller : la lame s'éloigne
    progress = time / halfTime; // 0 à 1
  } else {
    // Retour : la lame revient
    progress = (maxTime - time) / halfTime; // 1 à 0
  }

  const maxRadius = 20; // distance max de la lame au joueur
  const radius = 20 + progress * maxRadius; // rayon variable selon progress

  const alpha = 1 - (time / maxTime);

  // Nombre de dents sur la lame circulaire
  const teethCount = 12;
  const teethLength = 15;

  ctx.save();
  ctx.translate(x + offsetX, y + offsetY);

  // Cercle central "base" du couteau
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(100, 100, 100, ${alpha.toFixed(2)})`;
  ctx.fill();

  // Dessin de la lame en dent de scie tout autour
  for (let i = 0; i < teethCount; i++) {
    const angle = (2 * Math.PI / teethCount) * i + (time * 0.3); // rotation continue

    // Position extérieure de la dent
    const outerX = radius * Math.cos(angle);
    const outerY = radius * Math.sin(angle);

    // Position intérieure vers le centre, crée dent de scie
    const innerRadius = radius - teethLength;
    const innerX = innerRadius * Math.cos(angle + 0.05);
    const innerY = innerRadius * Math.sin(angle + 0.05);

    ctx.beginPath();
    ctx.moveTo(innerX, innerY);
    ctx.lineTo(outerX, outerY);

    // Petite "dent" triangulaire
    const midAngle = angle + 0.025;
    const midRadius = radius + 5 * progress; // léger allongement au milieu
    const midX = midRadius * Math.cos(midAngle);
    const midY = midRadius * Math.sin(midAngle);

    ctx.lineTo(midX, midY);
    ctx.closePath();

    ctx.fillStyle = `rgba(200, 200, 200, ${alpha.toFixed(2)})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(150, 150, 150, ${alpha.toFixed(2)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}


// Wrapper pour dessiner un slashEffect, pour éviter erreur
function drawSlashEffect(e, offsetX, offsetY) {
  drawKnifeSlashEffect(e.x, e.y, e.time, e.maxTime, offsetX, offsetY);
  e.time++;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!playerId || !players[playerId]) {
    requestAnimationFrame(draw);
    return;
  }

  const player = players[playerId];
  const offsetX = canvas.width / 2 - player.x;
  const offsetY = canvas.height / 2 - player.y;

  walls.forEach(w => {
    ctx.fillStyle = "#999";
    ctx.fillRect(w.x + offsetX, w.y + offsetY, w.width, w.height);
  });

  Object.values(players).forEach(p => {
    if (p.dead) return;
    let dx = 0, dy = 0;
    if (p.input) { // protection
      if (p.input.up) dy -= 1;
      if (p.input.down) dy += 1;
      if (p.input.left) dx -= 1;
      if (p.input.right) dx += 1;
    }

    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
      p.moveDir = { x: dx, y: dy };
      if (p.dashing) {
        for (let i = 0; i < 3; i++) {
          const spreadX = (Math.random() - 0.5) * 10;
          const spreadY = (Math.random() - 0.5) * 10;
          const smokeX = p.x - dx * 25 + spreadX;
          const smokeY = p.y - dy * 25 + spreadY;
          smokeParticles.push({
            x: smokeX,
            y: smokeY,
            alpha: 1,
            radius: 3 + Math.random() * 3
          });
        }
      }
    } else {
      p.moveDir = null;
    }
  });

  Object.values(players).forEach(p => drawPlayer(p, offsetX, offsetY));

  bullets.forEach(b => {
    ctx.fillStyle = "orange";
    ctx.beginPath();
    ctx.arc(b.x + offsetX, b.y + offsetY, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  drawSmoke(offsetX, offsetY);

  // Effets slash 360°
  slashEffects = slashEffects.filter(e => e.time < e.maxTime);
  slashEffects.forEach(e => {
    const p = players[e.playerId];
    if (p) {
      e.x = p.x;
      e.y = p.y;
    }
    drawSlashEffect(e, offsetX, offsetY);
  });

  ctx.fillStyle = "#fff";
  ctx.font = "18px sans-serif";
  ctx.textAlign = "center";

  const centerX = canvas.width / 2;
  const bottomY = canvas.height - 40;

  ctx.fillText(`Munitions : ${player.ammo} / 15`, centerX, bottomY);
  if (player.reloading) {
    ctx.fillText("Rechargement...", centerX, bottomY + 24);
  }

  ctx.textAlign = "start";

  if (showStats) drawStats();

  requestAnimationFrame(draw);
}

function sendInput() {
  if (!playerId || !players[playerId]) return;

  const rect = canvas.getBoundingClientRect();
  const mouseX = mouse.x - rect.left;
  const mouseY = mouse.y - rect.top;
  const player = players[playerId];
  const angle = Math.atan2(mouseY - canvas.height / 2, mouseX - canvas.width / 2);

  socket.emit("input", {
    input: {
      up: keys["z"],
      down: keys["s"],
      left: keys["q"],
      right: keys["d"]
    },
    angle
  });
}

// Socket events
socket.on("init", data => {
  playerId = data.id;
  players = data.players;
  bullets = data.bullets;
  walls = data.walls;
});

socket.on("newPlayer", p => players[p.id] = p);
socket.on("removePlayer", id => delete players[id]);

// Mise à jour plus sûre des états (merge pour ne pas perdre propriétés locales)
socket.on("state", state => {

  // Conserver les anciens timestamps de rechargement
  for (let id in state.players) {
    const newP = state.players[id];
    const oldP = players[id];

    if (newP.reloading && (!oldP || !oldP.reloading)) {
      // Début du rechargement détecté
      newP.reloadStartTime = performance.now();
    } else if (oldP && oldP.reloadStartTime) {
      // Conserver le temps si déjà commencé
      newP.reloadStartTime = oldP.reloadStartTime;
    }
  }

  Object.keys(state.players).forEach(id => {
    if (players[id]) {
      Object.assign(players[id], state.players[id]);
    } else {
      players[id] = state.players[id];
    }
  });
  bullets = state.bullets;
  walls = state.walls;
});

// SlashEffect
socket.on("slashEffect", data => {
  slashEffects.push({ 
    playerId: data.playerId,
    x: data.x, 
    y: data.y, 
    angle: data.angle, 
    time: 0, 
    maxTime: 30 
  });
});

// Rejoindre le jeu
function joinGame() {
  const input = document.getElementById("pseudoInput");
  if (!input.value.trim()) {
    alert("Veuillez entrer un pseudo !");
    return;
  }
  playerName = input.value.trim();
  socket.emit("setName", playerName);
  document.getElementById("joinForm").style.display = "none";
  canvas.style.display = "block";

  if (!drawLoopStarted) {
    drawLoopStarted = true;
    draw();
  }

  if (!sendInputInterval) {
    sendInputInterval = setInterval(sendInput, 1000 / 60);
  }
  
  // Désactive le bouton pour éviter multiples clics
  document.getElementById("joinButton").disabled = true;
}

document.getElementById("joinButton").addEventListener("click", joinGame);
