// Match the game entrypoint's World-first entity initialization before loading
// login save serializers; Player-first traversal can reach Obj before its base.
import '#/engine/World.js';
import LoginServer from '#/server/login/LoginServer.js';
import { startMemoryDiagnostics } from '#/util/MemoryDiagnostics.js';

startMemoryDiagnostics('login');
new LoginServer();
