module.exports = {
  apps: [{
    name: "paie",
    cwd: "/var/www/paie_saas",
    script: "index.js",
    interpreter: "./node_modules/.bin/tsx",
    env: {
      NODE_ENV: "production"
    }
  }]
};
