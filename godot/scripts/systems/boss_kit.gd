## 巢穴主的技能组 —— `enemies.js` 的 `spawnDungeonBoss` / `bossAbility` / `updateBossCast`
## / `updateBossDash` / `updateBossBarrage` / `spawnDungeonGarrison` 的移植。
##
## 三件套（玩家要求的那三条）：
##   1. **红色感叹号预警后的冲撞**：起手时锁角度、停手 1.1 秒，玩家能侧移躲开；
##   2. **弹幕**：朝玩家方向扇形撒弹丸，分波发射（挂在 Boss 自己身上推进，不用浏览器计时器）；
##   3. **召唤**：固定数量的小怪，场上上限 8 只。
class_name BossKit

const TAU_F := PI * 2.0

## 副本 Boss 的技能组参数（与 JS `spawnDungeonBoss` 完全一致）
static func abilities_for(tier: int) -> Array:
	var t := float(tier)
	return [
		{
			"kind": "charge", "cd": 11.0 - minf(3.0, t * 0.2), "warn": 1.1,
			"dist": 520.0, "halfWidth": 54.0, "dmgMult": 2.2, "dashSpeed": 980.0, "t": 0.0,
		},
		{
			"kind": "barrage", "cd": 8.5, "count": 7 + int(floor(t / 2.0)), "spread": 1.15,
			"speed": 330.0, "dmgMult": 0.45, "waves": 2, "waveGap": 0.3, "t": 0.0,
		},
		{ "kind": "summonAdds", "cd": 16.0, "count": mini(6, 2 + int(floor(t / 3.0))), "t": 0.0 },
	]


## 初始冷却（与 JS 的 `for (const ab of boss.abilities) ab.t = rnd.range(2.0, ab.cd*0.55)` 同式）
static func seed_cooldowns(rng: Rng, abilities: Array) -> void:
	for ab in abilities:
		ab["t"] = rng.range_f(2.0, float(ab["cd"]) * 0.55)


## 副本 Boss 的血量/伤害缩放（JS：0.85 + (tier-1)*0.08，再乘 hp/dmg 的层数补偿）
static func boss_scale(planet_index: int, tier: int) -> Dictionary:
	var s := EnemyFactory.scale_for(planet_index, tier, 0.85 + float(tier - 1) * 0.08)
	s["hp"] = float(s["hp"]) * (1.0 + float(tier - 1) * 0.22)
	s["dmg"] = float(s["dmg"]) * (1.0 + float(tier - 1) * 0.12)
	return s


## 起手（预警）：只登记 casting，不结算伤害
static func begin_cast(e: Dictionary, ab: Dictionary, target_x: float, target_y: float) -> void:
	e["casting"] = {
		"kind": String(ab["kind"]), "t": float(ab.get("warn", 1.1)),
		"angle": GdMath.angle_to(float(e["x"]), float(e["y"]), target_x, target_y),
		"ab": ab,
	}
	e["angle"] = float(e["casting"]["angle"])


## 预警推进；时间到就把 cast 变成 dash（返回 true 表示这一帧刚冲出去）
static func update_cast(e: Dictionary, dt: float) -> bool:
	var c = e.get("casting")
	if not (c is Dictionary):
		return false
	c["t"] = float(c["t"]) - dt
	if float(c["t"]) > 0.0:
		e["chargeShake"] = 1.0
		return false
	e["chargeShake"] = 0.0
	if String(c["kind"]) == "charge":
		var ab: Dictionary = c["ab"]
		e["dash"] = {
			"x": cos(float(c["angle"])), "y": sin(float(c["angle"])),
			"remain": float(ab["dist"]), "speed": float(ab["dashSpeed"]),
			"halfWidth": float(ab["halfWidth"]),
			"dmg": float(e["dmg"]) * float(ab["dmgMult"]),
			"hit": {},
		}
	e["casting"] = null
	return true


## 冲撞推进：撞墙就停并震一下；撞到玩家/建筑按伤害结算
## 返回 { moved, hitPlayer, hitBuilding, stopped }
## world 故意不加类型标注：JS 里它也是鸭子类型，测试用「永不阻挡」的替身最方便
static func update_dash(e: Dictionary, dt: float, world, player,
	buildings: Array = []) -> Dictionary:
	var d = e.get("dash")
	var out := { "moved": false, "hitPlayer": false, "hitBuilding": false, "stopped": false }
	if not (d is Dictionary):
		return out
	var step := minf(float(d["speed"]) * dt, float(d["remain"]))
	var nx := float(e["x"]) + float(d["x"]) * step
	var ny := float(e["y"]) + float(d["y"]) * step
	if world != null and world.circle_blocked(nx, ny, float(e["r"]) * 0.8):
		e["dash"] = null
		e["stun"] = maxf(float(e.get("stun", 0.0)), 0.5)
		out["stopped"] = true
		return out
	e["x"] = nx
	e["y"] = ny
	d["remain"] = float(d["remain"]) - step
	out["moved"] = true
	# 撞玩家
	var hit: Dictionary = d.get("hit", {})
	if player != null and not GdMath.truthy(hit.get("player", false)):
		if GdMath.dist(float(e["x"]), float(e["y"]), player.position.x, player.position.y) < float(e["r"]) + 13.0 + 6.0:
			hit["player"] = true
			out["hitPlayer"] = true
			if player.has_method("take_damage"):
				player.take_damage(float(d["dmg"]), "冲撞")
	# 撞建筑
	for b in buildings:
		if float(b.get("hp", 1.0)) <= 0.0:
			continue
		if GdMath.dist(float(e["x"]), float(e["y"]), float(b["x"]), float(b["y"])) > float(e["r"]) + float(b.get("r", 30.0)):
			continue
		var key := "b%d" % int(b.get("id", 0))
		if GdMath.truthy(hit.get(key, false)):
			continue
		hit[key] = true
		out["hitBuilding"] = true
		b["hp"] = float(b["hp"]) - float(d["dmg"]) * 0.8
	d["hit"] = hit
	if float(d["remain"]) <= 0.5:
		e["dash"] = null
		out["stopped"] = true
	return out


## 弹幕：起手时挂一个 e.barrage，之后每帧推进
static func begin_barrage(e: Dictionary, ab: Dictionary, target_x: float, target_y: float) -> void:
	var base := GdMath.angle_to(float(e["x"]), float(e["y"]), target_x, target_y)
	e["barrage"] = {
		"base": base, "left": maxi(1, int(ab.get("waves", 1))), "gap": float(ab.get("waveGap", 0.3)),
		"timer": 0.0, "count": maxi(3, int(ab["count"])), "spread": float(ab["spread"]),
		"speed": float(ab.get("speed", 320.0)), "dmgMult": float(ab.get("dmgMult", 0.5)),
	}


## 推进弹幕：到点就撒一波；返回本帧要发射的弹丸参数数组（由 Projectiles 负责生成）
static func update_barrage(e: Dictionary, dt: float) -> Array:
	var b = e.get("barrage")
	if not (b is Dictionary):
		return []
	b["timer"] = float(b["timer"]) - dt
	if float(b["timer"]) > 0.0:
		return []
	b["timer"] = float(b["gap"])
	b["left"] = int(b["left"]) - 1
	var n := int(b["count"])
	var out: Array = []
	for i in n:
		var a := float(b["base"]) + (float(i) - (float(n) - 1.0) / 2.0) * (float(b["spread"]) / float(n)) * 2.0
		out.append({
			"angle": a, "speed": float(b["speed"]), "damage": float(e["dmg"]) * float(b["dmgMult"]),
		})
	if int(b["left"]) <= 0:
		e["barrage"] = null
	return out


## 召唤：固定数量、场上上限 8 只（与 JS 的 `8 - live` 一致）
static func summon_count(ab: Dictionary, live_summons: int) -> int:
	return maxi(0, mini(int(ab["count"]), 8 - live_summons))
