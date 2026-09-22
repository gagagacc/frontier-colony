## 科技树（图形化）—— 对应 JS `panelTech.js` 的 `renderGraph`。
##
## 原版不是文字列表，而是**节点图**：
##   - 按**分支**分页（防御工程 / 武器火力 / 后勤管理 / 探索 / 生物）；
##   - 分支内按**前置深度**分列（tier → 列），同列的节点竖着排；
##   - 武器火力那 4 条线是**平行**的（射程/伤害/射速/弹道），按 `lane` 一条线一行；
##   - 节点是 104~116 × 74 的方块，**前置之间连线**；
##   - 状态用颜色区分：已解锁 / 可研发且买得起 / 可研发但缺资源 / 未开放。
##
## 这一版用 Godot 的 `_draw` 直接画（节点 + 连线），点击命中用矩形判定。
class_name TechTreeView extends Control

const NODE_W := 116.0
const NODE_H := 74.0
const COL_GAP := 46.0
const ROW_GAP := 18.0
const NARROW_W := 104.0
const NARROW_GAP := 28.0
const PAD := 10.0

const COL_UNLOCKED := Color("#6ee7a8")
const COL_READY := Color("#8fe0ff")
const COL_POOR := Color("#ffba4c")
const COL_LOCKED := Color("#4a5462")
const COL_LINE := Color(0.55, 0.66, 0.78, 0.5)

var techs: Dictionary = {}         # id -> def
var unlocked: Dictionary = {}      # id -> true
var resources: Dictionary = {}
var char_id := "engineer"
var branch := ""
var order: Array = []              # 分支顺序
var layout: Dictionary = {}        # id -> Rect2
var focused := ""
var enabled := true
var on_pick: Callable = Callable()  # 点某个「可研发」节点时回调(id)

var _branch_defs: Dictionary = {}
var _branches: Dictionary = {}     # branch -> [tech def...]


func setup(p_techs: Dictionary, p_unlocked: Dictionary, p_resources: Dictionary,
	p_char: String) -> void:
	techs = p_techs
	unlocked = p_unlocked
	resources = p_resources
	char_id = p_char
	_branch_defs = DataLoader.new().module("tech").get("BRANCH_DEF", {})
	_branches.clear()
	for id in techs.keys():
		var t: Dictionary = techs[id]
		if t.has("exclusive") and String(t["exclusive"]) != char_id:
			continue
		# hideFor：这个角色不需要看到的节点（驾驶员不需要「载具申请」——他开局就有车）
		if (t.has("hideFor") and (t["hideFor"] as Array).has(char_id)):
			continue
		var b := String(t.get("branch", "defense"))
		if not _branches.has(b):
			_branches[b] = []
		(_branches[b] as Array).append(t)
	order = _branches.keys()
	order.sort()
	if branch == "" and not order.is_empty():
		branch = String(order[0])
	relayout()


## 列 = 前置深度；有 lane 的分支一条线一行（与 JS 同算法）
func relayout() -> void:
	layout.clear()
	var list: Array = _branches.get(branch, [])
	if list.is_empty():
		return
	# 深度：前置全部解锁后才算下一层；按 req 链算
	var depth := {}
	for t in list:
		depth[String(t["id"])] = 0
	for _pass in list.size():
		for t in list:
			var d := 0
			for r in t.get("req", []):
				d = maxi(d, int(depth.get(String(r), 0)) + 1)
			depth[String(t["id"])] = d
	var tiers: Array = []
	for t in list:
		var d: int = int(depth[String(t["id"])])
		while tiers.size() <= d:
			tiers.append([])
		(tiers[d] as Array).append(t)
	var cols := tiers.size()
	var node_w := NARROW_W if cols >= 6 else NODE_W
	var col_gap := NARROW_GAP if cols >= 6 else COL_GAP
	# 有 lane 就按 lane 行排（武器火力的 4 条线）
	var laned := true
	for t in list:
		if t.get("lane", null) == null:
			laned = false
			break
	if laned:
		for ci in cols:
			for t in tiers[ci]:
				layout[String(t["id"])] = Rect2(
					PAD + float(ci) * (node_w + col_gap),
					PAD + float(t["lane"]) * (NODE_H + ROW_GAP), node_w, NODE_H)
	else:
		var max_rows := 1
		for col in tiers:
			max_rows = maxi(max_rows, (col as Array).size())
		var total_h := float(max_rows) * NODE_H + float(max_rows - 1) * ROW_GAP
		for ci in cols:
			var items: Array = tiers[ci]
			var h := float(items.size()) * NODE_H + float(items.size() - 1) * ROW_GAP
			var top := (total_h - h) / 2.0
			for ri in items.size():
				layout[String(items[ri]["id"])] = Rect2(
					PAD + float(ci) * (node_w + col_gap),
					PAD + top + float(ri) * (NODE_H + ROW_GAP), node_w, NODE_H)


func content_size() -> Vector2:
	var mx := 0.0
	var my := 0.0
	for id in layout.keys():
		var r: Rect2 = layout[id]
		mx = maxf(mx, r.end.x)
		my = maxf(my, r.end.y)
	return Vector2(mx + PAD, my + PAD)


func state_of(id: String) -> String:
	if unlocked.has(id):
		return "unlocked"
	for r in (techs[id] as Dictionary).get("req", []):
		if not unlocked.has(String(r)):
			return "locked"
	return "ready"


func can_afford(cost: Dictionary) -> bool:
	for k in cost.keys():
		if float(resources.get(String(k), 0.0)) < float(cost[k]):
			return false
	return true


## 把图内容画到外部传入的 CanvasItem 上（这样同一份绘制逻辑既能自绘、也能塞进 ScrollContainer）
func draw_into(c: CanvasItem) -> void:
	_draw_on(c)


func _draw() -> void:
	_draw_on(self)


func _draw_on(c: CanvasItem) -> void:
	var font := ThemeDB.fallback_font
	# ① 先画连线（在节点下面）
	for id in techs.keys():
		var s := String(id)
		if not layout.has(s):
			continue
		var t: Dictionary = techs[id]
		for r in t.get("req", []):
			var rs := String(r)
			if not layout.has(rs):
				continue
			var a: Rect2 = layout[rs]
			var b: Rect2 = layout[s]
			var p1 := Vector2(a.end.x, a.position.y + a.size.y / 2.0)
			var p2 := Vector2(b.position.x, b.position.y + b.size.y / 2.0)
			var mid := (p1.x + p2.x) / 2.0
			var col := COL_LINE if unlocked.has(rs) else Color(0.3, 0.34, 0.4, 0.5)
			c.draw_line(p1, Vector2(mid, p1.y), col, 2.0)
			c.draw_line(Vector2(mid, p1.y), Vector2(mid, p2.y), col, 2.0)
			c.draw_line(Vector2(mid, p2.y), p2, col, 2.0)
	# ② 节点
	for s in layout.keys():
		var id := String(s)
		var r: Rect2 = layout[id]
		var t: Dictionary = techs[id]
		var st := state_of(id)
		var edge := COL_LOCKED
		var fill := Color(0.10, 0.12, 0.16, 0.96)
		match st:
			"unlocked":
				edge = COL_UNLOCKED
				fill = Color(0.10, 0.22, 0.16, 0.96)
			"locked":
				edge = COL_LOCKED
			_:
				edge = COL_READY if can_afford(t.get("cost", {})) else COL_POOR
		c.draw_rect(r, fill)
		c.draw_rect(r, edge, false, 2.0)
		if id == focused:
			c.draw_rect(r.grow(3.0), Color(1, 1, 1, 0.75), false, 2.0)
		# 标题（超长截断，避免压出格子）
		var name := String(t.get("name", id))
		if name.length() > 8:
			name = name.substr(0, 7) + "…"
		c.draw_string(font, r.position + Vector2(8, 22), name, HORIZONTAL_ALIGNMENT_LEFT, -1, 15,
			edge if st != "locked" else Color("#8b95a3"))
		# 造价逐项（够=紫，不够=红）
		var cost: Dictionary = t.get("cost", {})
		var y := r.position.y + 42.0
		for k in cost.keys():
			var need := float(cost[k])
			var have := float(resources.get(String(k), 0.0))
			var txt := "%s %d" % [Names.resource(String(k)), int(need)]
			c.draw_string(font, Vector2(r.position.x + 8, y), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 12,
				Color("#c08cff") if have >= need else Color("#ff5f6d"))
			y += 15.0
			if y > r.end.y - 6.0:
				break
		# 状态角标
		var tag: String = String({"unlocked": "✓", "ready": "＋", "poor": "缺", "locked": "锁"}.get(st, "?"))
		c.draw_string(font, Vector2(r.end.x - 22, r.position.y + 22), String(tag),
			HORIZONTAL_ALIGNMENT_LEFT, -1, 14, edge)


func _gui_input(event: InputEvent) -> void:
	if not enabled:
		return
	if event is InputEventMouseButton and event.pressed \
		and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		var m := (event as InputEventMouseButton).position
		for id in layout.keys():
			if (layout[id] as Rect2).has_point(m):
				focused = String(id)
				if state_of(focused) == "ready" and can_afford((techs[focused] as Dictionary).get("cost", {})):
					if on_pick.is_valid():
						on_pick.call(focused)
				queue_redraw()
				return
