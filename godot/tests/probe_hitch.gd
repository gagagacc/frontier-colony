## 走路卡顿探针：一边走一边记录每帧耗时，把「哪一段在掉帧」量化出来。
##
##   godot --headless --path godot --script res://tests/probe_hitch.gd -- --seconds=12
##
## 输出每帧 ms 的分布（p50/p95/最大值）与最慢的几帧发生在哪一步，
## 这样「一卡一卡」就不再是主观感受，而是能对比修前修后的数字。
extends SceneTree

var seconds := 12.0


func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--seconds="):
			seconds = a.substr(10).to_float()
	_run()


func _run() -> void:
	var world := GdWorld.new("hitch-probe", {})
	var stats := StatSet.new()
	var props := Props.new()
	props.setup(world)
	var budget := FrameBudget.new()
	# 用异步流场：重算进后台线程，主线程这一帧不等它
	var aflow := AsyncFlow.new()
	aflow.request(Vector2i(int(world.base_site["tx"]), int(world.base_site["ty"])), world.tiles)

	var px := float(world.base_site["x"])
	var py := float(world.base_site["y"])
	var dt := 1.0 / 60.0
	var frames: Array = []
	var chunk_frames := 0
	var chunk_total := 0
	var flow_frames := 0
	var steps := int(seconds * 60.0)
	# 每帧走 3px（约等于正常步行）
	for i in steps:
		var t0 := Time.get_ticks_usec()
		px += 3.0
		budget.tick(dt)
		var made := budget.pump_chunks(props, px, py, 1400.0)
		if made > 0:
			chunk_frames += 1
			chunk_total += made
		var goal := Vector2i(int(px / Cfg.TILE), int(py / Cfg.TILE))
		aflow.poll()
		if budget.allow_flow():
			flow_frames += 1
			aflow.request(goal, world.tiles)
		var ms := float(Time.get_ticks_usec() - t0) / 1000.0
		frames.append(ms)
	frames.sort()
	var n := frames.size()
	var p50: float = frames[int(n * 0.5)]
	var p95: float = frames[int(n * 0.95)]
	var worst: float = frames[n - 1]
	var avg := 0.0
	for f in frames:
		avg += f
	avg /= float(maxi(1, n))
	print("HITCH_PROBE " + JSON.stringify({
		"steps": n, "avgMs": snappedf(avg, 0.01), "p50": snappedf(p50, 0.01),
		"p95": snappedf(p95, 0.01), "worst": snappedf(worst, 0.01),
		"chunkFrames": chunk_frames, "chunksMade": chunk_total,
		"flowFrames": flow_frames, "props": props.props.size(),
	}))
	print("每帧平均 %.2fms · p50 %.2f · p95 %.2f · 最慢 %.2f · 生成区块 %d 个（%d 帧）· 流场重算 %d 次" % [
		avg, p50, p95, worst, chunk_total, chunk_frames, flow_frames])
	quit(0)
