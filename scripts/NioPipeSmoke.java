import java.nio.channels.Pipe;
import java.nio.channels.Selector;

final class NioPipeSmoke {
    public static void main(String[] args) throws Exception {
        Pipe pipe = Pipe.open();
        try (Pipe.SourceChannel source = pipe.source();
             Pipe.SinkChannel sink = pipe.sink();
             Selector selector = Selector.open()) {
            source.configureBlocking(false);
            source.register(selector, source.validOps());
        }
    }
}
