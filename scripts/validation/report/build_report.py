"""Inject the report data into the page template. Usage: python build_report.py <data.json> <out.html>"""
import sys
data = open(sys.argv[1]).read().replace("</", "<\\/")
page = open(__file__.replace("build_report.py", "report.template.html")).read().replace("__DATA__", data)
open(sys.argv[2], "w").write(page)
print("wrote", sys.argv[2], len(page) // 1024, "KB")
