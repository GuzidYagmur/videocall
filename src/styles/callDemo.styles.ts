import { StyleSheet } from 'react-native';

export default StyleSheet.create({
  scroll: {
    marginTop: 30,
    flexGrow: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  debug: {
    fontSize: 11,
    color: '#666',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    marginRight: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    backgroundColor: 'white',
  },
  btns: {
    gap: 8,
    marginBottom: 24,
  },
  btnBase: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: '#007AFF',
  },
  btnDanger: {
    backgroundColor: '#FF3B30',
  },
  btnDisabled: {
    backgroundColor: '#C7C7CC',
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  sub: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  video: {
    width: '100%',
    height: 200,
    backgroundColor: 'black',
    borderRadius: 8,
  },
  placeholder: {
    width: '100%',
    height: 200,
    backgroundColor: '#E5E5EA',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
