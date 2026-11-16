<?php
declare(strict_types=1);
session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_THROW_ON_ERROR);
    exit;
}
function fail(string $message, int $status = 400): never { respond(['error'=>$message], $status); }
function db(): PDO {
    $dir = dirname(__DIR__).'/data';
    if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) fail('Storage unavailable', 500);
    $pdo = new PDO('sqlite:'.$dir.'/battleship.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 5
    ]);
    $pdo->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    $pdo->exec("CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL,
        host_id INTEGER NOT NULL REFERENCES players(id), guest_id INTEGER REFERENCES players(id),
        status TEXT NOT NULL DEFAULT 'waiting', turn_id INTEGER REFERENCES players(id),
        winner_id INTEGER REFERENCES players(id), state TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS shots (
        id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id),
        player_id INTEGER NOT NULL REFERENCES players(id),
        x INTEGER NOT NULL, y INTEGER NOT NULL, result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(game_id, player_id, x, y)
    )");
    return $pdo;
}
function player(): int {
    // Passwordless LAN identities are selected per browser tab, not per PHP cookie.
    // Two tabs may share PHPSESSID while representing different commanders.
    $claimed=$_SERVER['HTTP_X_BATTLESHIP_PLAYER']??null;
    if ($claimed!==null) {
        if (!ctype_digit((string)$claimed) || (int)$claimed<1) fail('Invalid player identity',401);
        $id=(int)$claimed;
        $q=db()->prepare('SELECT id,name FROM players WHERE id=?');
        $q->execute([$id]);
        $selected=$q->fetch();
        if (!$selected || preg_match('/^AI [1-6]$/i',$selected['name'])) fail('Unknown player identity',401);
        return $id;
    }
    if (empty($_SESSION['player_id'])) fail('Select a player first', 401);
    return (int) $_SESSION['player_id'];
}
function input(): array {
    $body = json_decode(file_get_contents('php://input') ?: '{}', true);
    if (!is_array($body)) fail('Invalid JSON');
    return $body;
}
function action(): string { return (string)($_GET['action'] ?? ''); }
function game(PDO $db, int $id): array {
    $q=$db->prepare('SELECT * FROM games WHERE id=?'); $q->execute([$id]);
    return $q->fetch() ?: fail('Game not found', 404);
}
function config(int $size): array {
    return match ($size) {
        8 => [4,3,2],
        10 => [5,4,3,3,2],
        12 => [5,4,4,3,3,2],
        default => fail('Choose 8, 10, or 12 cells')
    };
}
function deploy(int $size): array {
    $fleet=[];
    foreach (config($size) as $length) {
        $placed=false;
        for ($attempt=0;$attempt<3000;$attempt++) {
            $vertical=random_int(0,1)===1;
            $x=random_int(0,$size-($vertical?1:$length));
            $y=random_int(0,$size-($vertical?$length:1));
            $cells=[];
            for ($i=0;$i<$length;$i++) $cells[]=[$x+($vertical?0:$i),$y+($vertical?$i:0)];
            $used=[];
            foreach ($fleet as $ship) foreach ($ship as $cell) $used[$cell[0].','.$cell[1]]=true;
            foreach ($cells as $cell) if (isset($used[$cell[0].','.$cell[1]])) continue 2;
            $fleet[]=$cells; $placed=true; break;
        }
        if (!$placed) fail('Could not place fleet',500);
    }
    return $fleet;
}

/** Validate one contiguous straight vessel with the same length as its original. */
function placementCells(int $size, array $fleet, int $index, int $x, int $y, string $direction): array {
    if (!isset($fleet[$index]) || !is_array($fleet[$index])) fail('Unknown vessel');
    if (!in_array($direction, ['horizontal','vertical'], true)) fail('Invalid orientation');
    $length=count($fleet[$index]);
    if ($length<2 || $length>5) fail('Invalid ship length');
    $cells=[];
    $used=[];
    foreach ($fleet as $i=>$ship) {
        if ($i===$index) continue;
        foreach ($ship as $cell) $used[$cell[0].','.$cell[1]]=true;
    }
    for ($offset=0;$offset<$length;$offset++) {
        $cx=$x+($direction==='horizontal'?$offset:0);
        $cy=$y+($direction==='vertical'?$offset:0);
        if ($cx<0 || $cy<0 || $cx>=$size || $cy>=$size) fail('Ship extends beyond the board');
        if (isset($used[$cx.','.$cy])) fail('Ship overlaps another vessel');
        $cells[]=[$cx,$cy];
    }
    return $cells;
}

function shots(PDO $db, int $id): array {
    $q=$db->prepare('SELECT id,player_id,x,y,result FROM shots WHERE game_id=? ORDER BY id');
    $q->execute([$id]); return $q->fetchAll();
}
function view(PDO $db, array $g, int $me): array {
    $id=(int)$g['id'];
    if (!in_array($me, [(int)$g['host_id'],(int)$g['guest_id']],true)) fail('Not a player in this game', 403);
    $state=json_decode($g['state'],true,512,JSON_THROW_ON_ERROR);
    $mine=$me===(int)$g['host_id']?'host':'guest';
    $theirs=$mine==='host'?'guest':'host';
    $all=shots($db,$id);
    $own=[];$target=[];
    foreach ($all as $s) {
        $line=['id'=>(int)$s['id'],'x'=>(int)$s['x'],'y'=>(int)$s['y'],'result'=>$s['result']];
        if ((int)$s['player_id']===$me) $target[]=$line; else $own[]=$line;
    }
    $finished=$g['status']==='finished';
    return [
        'id'=>$id,'name'=>$g['name'],'size'=>(int)$g['size'],
        'ai_level'=>(int)($state['ai_level']??0),
        'status'=>$g['status'],'host_id'=>(int)$g['host_id'],
        'guest_id'=>$g['guest_id']===null?null:(int)$g['guest_id'],
        'turn_id'=>$g['turn_id']===null?null:(int)$g['turn_id'],
        'winner_id'=>$g['winner_id']===null?null:(int)$g['winner_id'],
        'you'=>$me,'ready'=>(bool)$state[$mine]['ready'],
        'enemy_ready'=>(bool)$state[$theirs]['ready'],
        'fleet'=>$state[$mine]['fleet'],
        'enemy_fleet'=>$finished?$state[$theirs]['fleet']:null,
        'own_shots'=>$own,'target_shots'=>$target
    ];
}

/**
 * Shoot using the exact same rules for human and computer players.
 * Caller must hold an IMMEDIATE transaction.
 */
function takeShot(PDO $db, array $g, int $shooter, int $x, int $y): array {
    if ($g['status']!=='active' || (int)$g['turn_id']!==$shooter) fail('Not your turn',409);
    $size=(int)$g['size'];
    if ($x<0 || $y<0 || $x>=$size || $y>=$size) fail('Invalid target');
    $id=(int)$g['id'];
    $state=json_decode($g['state'],true,512,JSON_THROW_ON_ERROR);
    $enemy=$shooter===(int)$g['host_id']?'guest':'host';
    $q=$db->prepare('SELECT x,y FROM shots WHERE game_id=? AND player_id=?');
    $q->execute([$id,$shooter]);
    $prior=array_map(fn($r)=>[(int)$r['x'],(int)$r['y']],$q->fetchAll());
    if (in_array([$x,$y],$prior,true)) fail('Already fired at that cell',409);
    $after=$prior;
    $after[]=[$x,$y];
    $hit=false;$sunk=false;
    foreach ($state[$enemy]['fleet'] as $ship) {
        if (!in_array([$x,$y],$ship,true)) continue;
        $hit=true;$sunk=true;
        foreach ($ship as $cell) if (!in_array($cell,$after,true)) $sunk=false;
        break;
    }
    $result=$sunk?'sunk':($hit?'hit':'miss');
    $q=$db->prepare('INSERT INTO shots(game_id,player_id,x,y,result) VALUES(?,?,?,?,?)');
    $q->execute([$id,$shooter,$x,$y,$result]);
    $won=true;
    foreach ($state[$enemy]['fleet'] as $ship)
        foreach ($ship as $cell) if (!in_array($cell,$after,true)) $won=false;
    $other=$enemy==='host'?(int)$g['host_id']:(int)$g['guest_id'];
    $q=$db->prepare("UPDATE games SET status=?,winner_id=?,turn_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
    $q->execute([$won?'finished':'active',$won?$shooter:null,$won?null:$other,$id]);
    return game($db,$id);
}
/**
 * AI knows only its own previous shots, their outcomes and the initial fleet
 * configuration. It never reads the opponent's hidden fleet.
 */
function chooseAiShot(PDO $db, array $g, int $level): array {
    $size=(int)$g['size'];
    $ai=(int)$g['guest_id'];
    $q=$db->prepare('SELECT x,y,result FROM shots WHERE game_id=? AND player_id=? ORDER BY id');
    $q->execute([(int)$g['id'],$ai]);
    $history=$q->fetchAll();
    $seen=[];$hits=[];$sunk=[];
    foreach ($history as $s) {
        $key=$s['x'].','.$s['y'];
        $seen[$key]=$s['result'];
        if ($s['result']==='hit') $hits[]=[(int)$s['x'],(int)$s['y']];
        if ($s['result']==='sunk') $sunk[]=[(int)$s['x'],(int)$s['y']];
    }
    $available=[];
    for ($y=0;$y<$size;$y++) for ($x=0;$x<$size;$x++)
        if (!isset($seen[$x.','.$y])) $available[]=[$x,$y];
    if (!$available) fail('AI has no remaining targets',500);
    $random=static fn(array $a): array=>$a[random_int(0,count($a)-1)];
    if ($level===1) return $random($available);
    $targets=[];
    foreach ($hits as [$hx,$hy]) {
        foreach ([[1,0],[-1,0],[0,1],[0,-1]] as [$dx,$dy]) {
            $tx=$hx+$dx;$ty=$hy+$dy;
            if ($tx>=0&&$ty>=0&&$tx<$size&&$ty<$size&&!isset($seen[$tx.','.$ty]))
                $targets[$tx.','.$ty]=[$tx,$ty];
        }
    }
    if ($level===2 && $targets) return $random(array_values($targets));
    // Level 3: checkerboard searching; Level 4: prioritize straight extensions.
    if ($level>=3 && $targets && $level<=4) {
        if ($level===4) {
            $scores=[];
            foreach ($targets as $key=>$cell) {
                [$x,$y]=$cell;$score=0;
                foreach ($hits as [$hx,$hy]) {
                    if (($hx===$x&&abs($hy-$y)===1)||($hy===$y&&abs($hx-$x)===1))$score+=2;
                    if ($hx===$x||$hy===$y)$score++;
                }
                $scores[$key]=$score;
            }
            $best=max($scores);return $random(array_values(array_filter($targets,fn($v,$k)=>$scores[$k]===$best,ARRAY_FILTER_USE_BOTH)));
        }
        return $random(array_values($targets));
    }
    if ($level<=4) {
        $pool=array_values(array_filter($available,fn($c)=>(($c[0]+$c[1])%2)===0));
        return $random($pool?:$available);
    }
    // Levels 5–6 score every possible placement of the remaining vessel lengths.
    // A placement cannot cross a known miss, and active hits increase its score.
    $lengths=config($size);
    foreach ($sunk as $_) { // one vessel ends at each sunk shot; approximate lengths remain
        if ($lengths) array_pop($lengths);
    }
    if (!$lengths) $lengths=[2];
    $scores=[];
    foreach ($available as [$x,$y]) $scores[$x.','.$y]=0;
    foreach ($lengths as $length) {
        for ($vertical=0;$vertical<=1;$vertical++)
            for ($y=0;$y<=$size-($vertical?$length:1);$y++)
                for ($x=0;$x<=$size-($vertical?1:$length);$x++) {
                    $cells=[];$valid=true;$covered=0;
                    for ($i=0;$i<$length;$i++) {
                        $cx=$x+($vertical?0:$i);$cy=$y+($vertical?$i:0);
                        $outcome=$seen[$cx.','.$cy]??null;
                        if ($outcome==='miss'||$outcome==='sunk') {$valid=false;break;}
                        if ($outcome==='hit') $covered++;
                        $cells[]=[$cx,$cy];
                    }
                    if (!$valid)continue;
                    $weight=$level===6?(1+$covered*10):1+$covered*4;
                    foreach ($cells as [$cx,$cy])
                        if (!isset($seen[$cx.','.$cy])) $scores[$cx.','.$cy]+=$weight;
                }
    }
    if ($targets) foreach ($targets as $key=>$cell) $scores[$key]+=($level===6?35:12);
    if (!$scores) return $random($available);
    $best=max($scores);
    $leaders=[];
    foreach ($available as $cell) if (($scores[$cell[0].','.$cell[1]]??0)===$best) $leaders[]=$cell;
    return $random($leaders?:$available);
}

function mutate(PDO $db, callable $f): mixed {
    $db->exec('BEGIN IMMEDIATE');
    try { $r=$f(); $db->commit(); return $r; }
    catch (Throwable $e) { $db->rollBack(); throw $e; }
}
try {
    $db=db();
    $action=action();
    if ($_SERVER['REQUEST_METHOD']==='GET') {
        if ($action==='players') {
            respond(['players'=>$db->query('SELECT id,name FROM players ORDER BY name')->fetchAll(),'selected'=>$_SESSION['player_id']??null]);
        }
        if ($action==='lobby') {
            $me=player();
            $q=$db->prepare("SELECT g.id,g.name,g.size,g.status,g.host_id,g.guest_id,g.turn_id,g.winner_id,
              h.name AS host_name, v.name AS guest_name FROM games g
              JOIN players h ON h.id=g.host_id LEFT JOIN players v ON v.id=g.guest_id
              WHERE g.status='waiting' OR g.host_id=? OR g.guest_id=?
              ORDER BY CASE WHEN g.status='finished' THEN 1 ELSE 0 END, g.updated_at DESC LIMIT 80");
            $q->execute([$me,$me]);
            respond(['games'=>$q->fetchAll(),'you'=>$me]);
        }
        if ($action==='game') respond(['game'=>view($db,game($db,(int)($_GET['id']??0)),player())]);
        if ($action==='stats') {
            $q=$db->query("SELECT p.id,p.name,
               SUM(CASE WHEN g.status='finished' THEN 1 ELSE 0 END) AS played,
               SUM(CASE WHEN g.winner_id=p.id THEN 1 ELSE 0 END) AS wins
               FROM players p LEFT JOIN games g ON (p.id=g.host_id OR p.id=g.guest_id)
               GROUP BY p.id ORDER BY wins DESC,p.name");
            respond(['players'=>$q->fetchAll()]);
        }
        fail('Unknown action',404);
    }
    if ($_SERVER['REQUEST_METHOD']!=='POST') fail('Method not allowed',405);
    // Reject cross-origin browser requests; credentials are cookie-based.
    if (isset($_SERVER['HTTP_ORIGIN'])) {
        $origin=parse_url($_SERVER['HTTP_ORIGIN']);
        if (!$origin || ($origin['host']??'')!==($_SERVER['HTTP_HOST'] ? explode(':',$_SERVER['HTTP_HOST'])[0] : '')) fail('Origin rejected',403);
    }
    $in=input();
    if ($action==='select') {
        $name=trim((string)($in['name']??''));
        if (strlen($name)>24 || strlen($name)<1) fail('Player names must be 1–24 characters');
        $q=$db->prepare('INSERT OR IGNORE INTO players(name) VALUES(?)');$q->execute([$name]);
        $q=$db->prepare('SELECT id,name FROM players WHERE name=? COLLATE NOCASE');$q->execute([$name]);
        $p=$q->fetch();if (!$p) fail('Unable to select player',500);
        if (preg_match('/^AI [1-6]$/i',$p['name'])) fail('AI players cannot be selected manually');
        session_regenerate_id(true);
        $_SESSION['player_id']=(int)$p['id'];
        respond(['player'=>$p]);
    }
    $me=player();
    if ($action==='create') {
        $name=trim((string)($in['name']??'North Atlantic'));
        if ($name==='' || strlen($name)>60) fail('Operation name must be 1–60 characters');
        $size=(int)($in['size']??10);config($size);
        $level=filter_var($in['ai_level']??0,FILTER_VALIDATE_INT);
        if ($level===false || $level<0 || $level>6) fail('AI level must be between 0 and 6');
        $guestId=null;
        if ($level>0) {
            $aiName='AI '.$level;
            $q=$db->prepare('INSERT OR IGNORE INTO players(name) VALUES(?)');$q->execute([$aiName]);
            $q=$db->prepare('SELECT id FROM players WHERE name=?');$q->execute([$aiName]);
            $guestId=(int)$q->fetchColumn();
            if ($guestId===$me) fail('Choose a human commander first');
        }
        $state=['host'=>['fleet'=>deploy($size),'ready'=>false],
                'guest'=>['fleet'=>$level?deploy($size):[],'ready'=>$level>0],
                'ai_level'=>$level];
        $q=$db->prepare("INSERT INTO games(name,size,host_id,guest_id,status,state) VALUES(?,?,?,?,?,?)");
        $q->execute([$name,$size,$me,$guestId,$level?'deployment':'waiting',json_encode($state,JSON_THROW_ON_ERROR)]);
        respond(['id'=>(int)$db->lastInsertId()]);
    }
    if ($action==='join') {
        $id=(int)($in['id']??0);
        $g=mutate($db,function()use($db,$id,$me){
            $g=game($db,$id);
            if ($g['status']!=='waiting'||$g['guest_id']!==null) fail('Game is not open',409);
            if ((int)$g['host_id']===$me) fail('Cannot join your own game');
            $state=json_decode($g['state'],true,512,JSON_THROW_ON_ERROR);
            $state['guest']['fleet']=deploy((int)$g['size']);
            $q=$db->prepare("UPDATE games SET guest_id=?,status='deployment',state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
            $q->execute([$me,json_encode($state,JSON_THROW_ON_ERROR),$id]);
            return game($db,$id);
        });
        respond(['game'=>view($db,$g,$me)]);
    }
    if ($action==='randomize'||$action==='place'||$action==='ready'||$action==='fire'||$action==='ai_turn') {
        $id=(int)($in['id']??0);
        $g=mutate($db,function()use($db,$id,$me,$action,$in){
            $g=game($db,$id);
            if (!in_array($me,[(int)$g['host_id'],(int)$g['guest_id']],true)) fail('Not your game',403);
            $state=json_decode($g['state'],true,512,JSON_THROW_ON_ERROR);
            $side=$me===(int)$g['host_id']?'host':'guest';
            if ($action==='randomize') {
                if (!in_array($g['status'],['waiting','deployment'],true)||$state[$side]['ready']) fail('Deployment is locked',409);
                $state[$side]['fleet']=deploy((int)$g['size']);
                $q=$db->prepare("UPDATE games SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
                $q->execute([json_encode($state,JSON_THROW_ON_ERROR),$id]);
            } elseif ($action==='place') {
                if (!in_array($g['status'],['waiting','deployment'],true)||$state[$side]['ready']) fail('Deployment is locked',409);
                $index=filter_var($in['ship']??null,FILTER_VALIDATE_INT);
                $x=filter_var($in['x']??null,FILTER_VALIDATE_INT);
                $y=filter_var($in['y']??null,FILTER_VALIDATE_INT);
                $direction=$in['direction']??null;
                if ($index===false||$x===false||$y===false||!is_string($direction)) fail('Invalid placement');
                $fleet=$state[$side]['fleet'];
                $fleet[$index]=placementCells((int)$g['size'],$fleet,$index,$x,$y,$direction);
                $state[$side]['fleet']=$fleet;
                $q=$db->prepare("UPDATE games SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
                $q->execute([json_encode($state,JSON_THROW_ON_ERROR),$id]);
            } elseif ($action==='ready') {
                if (!in_array($g['status'],['waiting','deployment'],true)) fail('Cannot ready now',409);
                $state[$side]['ready']=true;
                $start=$g['guest_id']!==null && $state['host']['ready'] && $state['guest']['ready'];
                $q=$db->prepare('UPDATE games SET state=?,status=?,turn_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?');
                $q->execute([json_encode($state,JSON_THROW_ON_ERROR),$start?'active':$g['status'],$start?(int)$g['host_id']:null,$id]);
            } elseif ($action==='ai_turn') {
                $level=(int)($state['ai_level']??0);
                if ($level<1 || $level>6 || (int)$g['host_id']!==$me) fail('Not your AI operation',403);
                // Idempotent: duplicate or delayed requests cannot fire a second AI shot.
                if ($g['status']==='active' && (int)$g['turn_id']===(int)$g['guest_id']) {
                    [$ax,$ay]=chooseAiShot($db,$g,$level);
                    $g=takeShot($db,$g,(int)$g['guest_id'],$ax,$ay);
                }
            } else {
                if ((int)$g['turn_id']!==$me) fail('Not your turn',409);
                $x=filter_var($in['x']??null,FILTER_VALIDATE_INT);
                $y=filter_var($in['y']??null,FILTER_VALIDATE_INT);
                if ($x===false||$y===false) fail('Invalid target');
                $g=takeShot($db,$g,$me,$x,$y);

            }
            return game($db,$id);
        });
        respond(['game'=>view($db,$g,$me)]);
    }
    fail('Unknown action',404);
} catch (Throwable $e) {
    error_log((string)$e);
    fail('Server error',500);
}
