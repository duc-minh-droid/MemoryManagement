#pragma once
// Tiny event tracer used by the allocators when the program runs with --trace.
// When tracing is off every hook is a single bool check, so the allocators
// behave exactly as before.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <ostream>
#include <string>
#include <typeinfo>
#include <vector>

namespace trace {

// Minimal JSON object builder. Keys are trusted literals, values are escaped.
class Json {
private:
	std::string body_;

	void key(const char* k) {
		if (!body_.empty()) body_ += ',';
		body_ += '"';
		body_ += k;
		body_ += "\":";
	}
public:
	static std::string quote(const std::string& s) {
		std::string out = "\"";
		for (char c : s) {
			switch (c) {
			case '"': out += "\\\""; break;
			case '\\': out += "\\\\"; break;
			case '\n': out += "\\n"; break;
			case '\t': out += "\\t"; break;
			default:
				if (static_cast<unsigned char>(c) < 0x20) {
					char buf[8];
					std::snprintf(buf, sizeof(buf), "\\u%04x", c);
					out += buf;
				}
				else {
					out += c;
				}
			}
		}
		return out + "\"";
	}

	Json& kv(const char* k, const std::string& v) { key(k); body_ += quote(v); return *this; }
	Json& kv(const char* k, const char* v) { return kv(k, std::string(v)); }
	Json& kv(const char* k, bool v) { key(k); body_ += v ? "true" : "false"; return *this; }
	Json& kv(const char* k, int v) { key(k); body_ += std::to_string(v); return *this; }
	Json& kv(const char* k, unsigned v) { key(k); body_ += std::to_string(v); return *this; }
	Json& kv(const char* k, long long v) { key(k); body_ += std::to_string(v); return *this; }
	Json& kv(const char* k, std::size_t v) { key(k); body_ += std::to_string(v); return *this; }
	Json& list(const char* k, const std::size_t* data, std::size_t n) {
		key(k);
		body_ += '[';
		for (std::size_t i = 0; i < n; ++i) {
			if (i) body_ += ',';
			body_ += std::to_string(data[i]);
		}
		body_ += ']';
		return *this;
	}
	const std::string& body() const { return body_; }
};

class Tracer {
private:
	bool enabled_ = false;
	std::vector<std::string> events_;
public:
	static Tracer& get() {
		static Tracer t;
		return t;
	}
	bool enabled() const { return enabled_; }
	void enable() { enabled_ = true; }

	void emit(const char* type, const Json& fields) {
		std::string e = "{\"seq\":" + std::to_string(events_.size()) + ",\"type\":\"" + type + "\"";
		if (!fields.body().empty()) e += "," + fields.body();
		events_.push_back(e + "}");
	}

	// Writes {"program":...,"events":[...]}; as a JS file it assigns window.MEMMAN_TRACE
	// so the web page can load it straight from disk (file:// cannot fetch JSON).
	void write(std::ostream& out, bool asJs) const {
		if (asJs) out << "window.MEMMAN_TRACE = ";
		out << "{\"program\":\"MemManBook\",\"version\":1,\"events\":[\n";
		for (std::size_t i = 0; i < events_.size(); ++i) {
			out << "  " << events_[i] << (i + 1 < events_.size() ? ",\n" : "\n");
		}
		out << "]}";
		out << (asJs ? ";\n" : "\n");
	}
};

inline bool on() { return Tracer::get().enabled(); }
inline void emit(const char* type, const Json& fields) {
	if (on()) Tracer::get().emit(type, fields);
}

// Tag type so allocators can ask for a type's display name without an object.
template<class T> struct type_tag {};

template<class T>
const char* trace_kind(type_tag<T>) { return typeid(T).name(); }

} // namespace trace

// Fallback label for traced objects. Game types overload this (found via ADL).
template<class T>
std::string trace_label(const T&) { return ""; }
