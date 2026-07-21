// ============================================================================
// botmatch.js - EGOBALL Bot Match System
// Features: AI bots with level-based difficulty, E-Coin rewards
// ============================================================================
const { Match, stadiumFor, PLAYER_RADIUS, BALL_RADIUS } = require('./physics');

class BotMatch {
  constructor(playerSocket, userData, level, io) {
    this.socket = playerSocket;
    this.userData = userData;
    this.level = level;
    this.io = io;
    this.match = null;
    this.tickHandle = null;
    this.broadcastHandle = null;
    this.botId = 'bot_' + Math.random().toString(36).slice(2, 8);
    this.botName = this.generateBotName();
    this.goals = 0;
    this.botGoals = 0;
  }

  generateBotName() {
    const names = ['Blaze', 'Frost', 'Shadow', 'Thunder', 'Viper', 'Phantom', 'Titan', 'Nova',
      'Rex', 'Zephyr', 'Onyx', 'Crimson', 'Steel', 'Venom', 'Storm', 'Havoc'];
    return names[Math.floor(Math.random() * names.length)];
  }

  start() {
    const teamSize = 1;
    this.match = new Match(
      'bot_' + this.socket.id,
      teamSize,
      (goalInfo) => this.handleGoal(goalInfo),
      (endInfo) => this.handleEnd(endInfo),
      false
    );

    // Add player
    this.match.addPlayer(this.socket.id, 'red', this.userData.displayName || this.userData.username, this.userData.stats);

    // Add bot with stats based on level
    const botStats = this.generateBotStats();
    this.match.addPlayer(this.botId, 'blue', this.botName, botStats);

    this.match.start();

    this.socket.emit('matchStarted', { 
      stadium: this.match.stadium, 
      isPractice: false,
      isBotMatch: true,
      botName: this.botName
    });

    // Start game loop
    this.tickHandle = setInterval(() => {
      if (this.match && this.match.running) {
        this.match.tick(1000 / 60);
        this.updateBotAI();
      }
    }, 1000 / 60);

    this.broadcastHandle = setInterval(() => {
      if (this.match) {
        this.socket.emit('state', this.match.serialize());
      }
    }, 1000 / 30);
  }

  generateBotStats() {
    const baseLevel = Math.max(1, this.level);
    return {
      speed: 0.8 + (baseLevel * 0.08),
      kick: 0.8 + (baseLevel * 0.08),
      jump: 0.8 + (baseLevel * 0.08),
      size: 0.9 + (baseLevel * 0.02)
    };
  }

  updateBotAI() {
    if (!this.match) return;
    const bot = this.match.players.get(this.botId);
    const ball = this.match.ball;
    if (!bot || !ball) return;

    const dx = ball.x - bot.x;
    const dy = ball.y - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Reset inputs
    bot.input.up = false;
    bot.input.down = false;
    bot.input.left = false;
    bot.input.right = false;
    bot.input.kick = false;
    bot.input.sprint = false;
    bot.input.powerKick = false;

    // Bot behavior based on ball position
    if (ball.x < 0) {
      // Ball on bot's side - defend
      const goalX = this.match.stadium.width / 2;
      const targetX = Math.min(ball.x + 50, goalX - 60);
      const targetY = ball.y * 0.5;

      if (bot.x < targetX - 10) bot.input.right = true;
      if (bot.x > targetX + 10) bot.input.left = true;
      if (bot.y < targetY - 10) bot.input.down = true;
      if (bot.y > targetY + 10) bot.input.up = true;
    } else {
      // Ball on player's side - attack
      if (dist < 40) {
        // Close to ball - try to kick toward goal
        if (dx < 0) {
          bot.input.left = true;
          bot.input.kick = true;
        } else {
          bot.input.right = true;
        }
        if (dy < 0) bot.input.up = true;
        if (dy > 0) bot.input.down = true;

        if (dist < 25 && Math.random() < 0.1) {
          bot.input.powerKick = true;
        }
      } else {
        // Move toward ball
        if (dx < -5) bot.input.left = true;
        if (dx > 5) bot.input.right = true;
        if (dy < -5) bot.input.up = true;
        if (dy > 5) bot.input.down = true;
      }
    }

    // Sprint randomly
    if (Math.random() < 0.02) bot.input.sprint = true;
  }

  setPlayerInput(input) {
    if (this.match) {
      this.match.setInput(this.socket.id, input);
    }
  }

  handleGoal(goalInfo) {
    this.socket.emit('goal', goalInfo);
    if (goalInfo.scoringTeam === 'red') {
      this.goals++;
    } else {
      this.botGoals++;
    }
  }

  handleEnd(endInfo) {
    this.socket.emit('matchEnded', {
      ...endInfo,
      isBotMatch: true,
      botName: this.botName,
      playerGoals: this.goals,
      botGoals: this.botGoals
    });
    this.stop();
  }

  stop() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.broadcastHandle) clearInterval(this.broadcastHandle);
    if (this.match) this.match.stop();
    this.match = null;
  }
}

module.exports = { BotMatch };
