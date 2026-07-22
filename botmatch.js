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

    const stadium = this.match.stadium;
    const hw = stadium.width / 2, hh = stadium.height / 2;
    // Bot defends the right side (blue), attacks toward the left goal (red's goal, x = -hw)
    const ownGoalX = hw;
    const targetGoalX = -hw;

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

    // Detect ball stuck in a corner (near a sideline AND near a goal-line, moving slowly)
    const nearSideline = Math.abs(ball.y) > hh - 45;
    const nearEndline = Math.abs(ball.x) > hw - 45;
    const ballSlow = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) < 0.6;
    const ballStuckInCorner = nearSideline && nearEndline && ballSlow;

    if (ballStuckInCorner && dist < 90) {
      // Approach from the side that pushes the ball away from the corner,
      // i.e. stand between the ball and the nearest corner point.
      const cornerX = ball.x > 0 ? hw : -hw;
      const cornerY = ball.y > 0 ? hh : -hh;
      const awayX = ball.x - Math.sign(cornerX) * 30;
      const awayY = ball.y - Math.sign(cornerY) * 30;
      const approachX = ball.x + (ball.x - cornerX > 0 ? 25 : -25);
      const approachY = ball.y + (ball.y - cornerY > 0 ? 25 : -25);

      if (bot.x < approachX - 8) bot.input.right = true;
      if (bot.x > approachX + 8) bot.input.left = true;
      if (bot.y < approachY - 8) bot.input.down = true;
      if (bot.y > approachY + 8) bot.input.up = true;

      if (dist < 34) {
        bot.input.kick = true;
      }
      return;
    }

    // Ball on bot's defensive half - go challenge it directly
    if (ball.x > 0) {
      if (dist < 34) {
        // Close enough - kick, but position on the far side of the ball
        // from our own goal so the kick naturally goes toward target goal
        bot.input.kick = true;
        if (Math.random() < 0.15) bot.input.powerKick = true;
      }
      if (dx > 4) bot.input.right = true;
      if (dx < -4) bot.input.left = true;
      if (dy > 4) bot.input.down = true;
      if (dy < -4) bot.input.up = true;
    } else {
      // Ball on attacking half - approach from the ownGoal side so the kick
      // direction naturally sends the ball toward targetGoalX instead of pinning it
      const behindX = ball.x + (ownGoalX > 0 ? 22 : -22);
      const behindY = ball.y;

      if (dist < 34) {
        bot.input.kick = true;
        if (dist < 24 && Math.random() < 0.12) bot.input.powerKick = true;
      }

      if (bot.x < behindX - 8) bot.input.right = true;
      if (bot.x > behindX + 8) bot.input.left = true;
      if (bot.y < behindY - 8) bot.input.down = true;
      if (bot.y > behindY + 8) bot.input.up = true;
    }

    // Sprint occasionally when chasing a distant ball
    if (dist > 120 && Math.random() < 0.03) bot.input.sprint = true;
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
