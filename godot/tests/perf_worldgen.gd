## 性能测量：世界生成在 GDScript 里要多久（对照 JS 的 ~0.2 秒）。
##
## 结论会影响架构选择：如果一次生成要好几秒，就必须
##   ① 生成时给进度界面 / 放线程池，② 把结果缓存到 user://，下次秒开。
extends SceneTree

func _initialize() -> void:
	var t0 := Time.get_ticks_msec()
	var w := GdWorld.new("perf-probe", {})
	var t1 := Time.get_ticks_msec()
	var hash_tiles := w.tiles_hash()
	var t2 := Time.get_ticks_msec()
	print("PERF worldgen_ms=%d hash_ms=%d tiles_hash=%d nests=%d" % [t1 - t0, t2 - t1, hash_tiles, w.nests.size()])
	quit(0)
