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
const keys = {};
const mouse = { x: 0, y: 0 };
let smokeParticles = [];
let playerName = null;
let showStats = false;
let drawLoopStarted = false;
let sendInputInterval = null;
let shooting = false;
let shootInterval = null;
let slashEffects = [];
let hasJoinedGame = false;



function startShooting() {
  if (!shooting) {
    shooting = true;
    socket.emit("shoot");
    shootInterval = setInterval(() => socket.emit("shoot"), 150);
  }
}

function stopShooting() {
  shooting = false;
  clearInterval(shootInterval);
}


// Dessin des joueurs, projectiles, effets...
function drawPlayer(p, offsetX, offsetY) {
  if (p.dead) return;

  const { x, y, angle, id, health, name, reloading, reloadStartTime } = p;
  const isCurrentPlayer = id === playerId;
  const reloadDuration = 2000;

  ctx.save();
  ctx.translate(x + offsetX, y + offsetY);
  ctx.rotate(angle);
  ctx.fillStyle = isCurrentPlayer ? "#72c2ff" : "#e74c3c";
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

  // Barre de vie
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(x + offsetX - 20, y + offsetY - 30, 40, 6);
  ctx.fillStyle = "#e74c3c";
  ctx.fillRect(x + offsetX - 20, y + offsetY - 30, 40 * (health / 100), 6);

  // Nom joueur
  ctx.fillStyle = "white";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(name || "Anonymous", x + offsetX, y + offsetY + 35);

  // Cercle rechargement
  if (reloading && reloadStartTime) {
    const elapsed = performance.now() - reloadStartTime;
    const progress = Math.min(elapsed / reloadDuration, 1);

    ctx.save();
    ctx.translate(x + offsetX, y + offsetY);
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
  sortedPlayers.forEach((p, i) => {
    ctx.fillStyle = p.id === playerId ? "#72c2ff" : "#fff";
    ctx.fillText(`${i + 1}. ${p.name || "Joueur"} - Kills: ${p.kills} | Morts: ${p.deaths}`, 70, 120 + i * 28);
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

function drawKnifeSlashEffect(x, y, time, maxTime, offsetX, offsetY) {
  const halfTime = maxTime / 2;
  const progress = time <= halfTime ? time / halfTime : (maxTime - time) / halfTime;
  const radius = 20 + progress * 20;
  const alpha = 1 - time / maxTime;
  const teethCount = 12;
  const teethLength = 15;

  ctx.save();
  ctx.translate(x + offsetX, y + offsetY);

  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(100, 100, 100, ${alpha.toFixed(2)})`;
  ctx.fill();

  for (let i = 0; i < teethCount; i++) {
    const angle = (2 * Math.PI / teethCount) * i + time * 0.3;
    const outerX = radius * Math.cos(angle);
    const outerY = radius * Math.sin(angle);
    const innerRadius = radius - teethLength;
    const innerX = innerRadius * Math.cos(angle + 0.05);
    const innerY = innerRadius * Math.sin(angle + 0.05);
    const midAngle = angle + 0.025;
    const midRadius = radius + 5 * progress;
    const midX = midRadius * Math.cos(midAngle);
    const midY = midRadius * Math.sin(midAngle);

    ctx.beginPath();
    ctx.moveTo(innerX, innerY);
    ctx.lineTo(outerX, outerY);
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


function drawSlashEffect(e, offsetX, offsetY) {
  drawKnifeSlashEffect(e.x, e.y, e.time, e.maxTime, offsetX, offsetY);
  e.time++;
}

function draw() {
  if (!hasJoinedGame || !playerId || !players[playerId]) {
    requestAnimationFrame(draw);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const player = players[playerId];
  const offsetX = canvas.width / 2 - player.x;
  const offsetY = canvas.height / 2 - player.y;

  ctx.fillStyle = "#999";
  walls.forEach(w => ctx.fillRect(w.x + offsetX, w.y + offsetY, w.width, w.height));

  Object.values(players).forEach(p => {
    if (p.dead) return;
    let dx = 0, dy = 0;
    if (p.input) {
      dx = (p.input.left ? -1 : 0) + (p.input.right ? 1 : 0);
      dy = (p.input.up ? -1 : 0) + (p.input.down ? 1 : 0);
    }

    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
      p.moveDir = { x: dx, y: dy };
      if (p.dashing) {
        for (let i = 0; i < 3; i++) {
          smokeParticles.push({
            x: p.x - dx * 25 + (Math.random() - 0.5) * 10,
            y: p.y - dy * 25 + (Math.random() - 0.5) * 10,
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

  ctx.fillStyle = "orange";
  bullets.forEach(b => {
    ctx.beginPath();
    ctx.arc(b.x + offsetX, b.y + offsetY, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  drawSmoke(offsetX, offsetY);

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


// Socket events
socket.on("init", data => {
  if (!hasJoinedGame) return;
  ({ id: playerId, players, bullets, walls } = data);
});

socket.on("newPlayer", p => {
  if (!hasJoinedGame) return;
  players[p.id] = p;
});

socket.on("removePlayer", id => {
  if (!hasJoinedGame) return;
  delete players[id];
});

socket.on("state", state => {
  if (!hasJoinedGame) return;

  for (const id in state.players) {
    const newP = state.players[id];
    const oldP = players[id];
    if (newP.reloading && (!oldP || !oldP.reloading)) {
      newP.reloadStartTime = performance.now();
    } else if (oldP && oldP.reloadStartTime) {
      newP.reloadStartTime = oldP.reloadStartTime;
    }
  }

  Object.entries(state.players).forEach(([id, newP]) => {
    players[id] = players[id] ? Object.assign(players[id], newP) : newP;
  });
  bullets = state.bullets;
  walls = state.walls;
});

socket.on("slashEffect", data => {
  if (!hasJoinedGame) return;
  slashEffects.push({ 
    playerId: data.playerId,
    x: data.x, 
    y: data.y, 
    angle: data.angle, 
    time: 0, 
    maxTime: 30 
  });
});

function joinGame() {
  const input = document.getElementById("pseudoInput");
  const pseudo = input.value.trim();
  if (!pseudo) {
    alert("Veuillez entrer un pseudo !");
    return;
  }
  playerName = pseudo;
  socket.emit("setName", playerName);

  hasJoinedGame = true;

  document.getElementById("joinForm").style.display = "none";
  canvas.style.display = "block";

  if (!drawLoopStarted) {
    drawLoopStarted = true;
    draw();
  }

  if (!sendInputInterval) {
    sendInputInterval = setInterval(sendInput, 1000 / 60);
  }

  document.getElementById("joinButton").disabled = true;
}

document.getElementById("joinButton").addEventListener("click", joinGame);
