<template>
	<div
		v-bar
		class="scroll-area">
		<div class="default-body">
			<div class="background" :style="{ backgroundImage: 'url(' + (config.backgroundImageURL !== '' ? config.backgroundImageURL : '_nuxt/src/site/assets/images/logo.png') + ')' }" />
			<Navbar :is-white="true" />
			<nuxt-child
				id="app"
				class="nuxt-app is-height-max-content" />
			<Footer />
		</div>
	</div>
</template>
<script>
import { mapState } from 'vuex';
import Navbar from '~/components/navbar/Navbar.vue';
import Footer from '~/components/footer/Footer.vue';

export default {
	components: {
		Navbar,
		Footer
	},
	computed: mapState(['config', 'alert']),
	created() {
		this.$store.watch(state => state.alert.message, () => {
			const { message, type, snackbar } = this.alert;

			if (!message) return;

			if (snackbar) {
				this.$buefy.snackbar.open({
					duration: 3500,
					position: 'is-bottom',
					message,
					type
				});
			} else {
				this.$buefy.toast.open({
					duration: 3500,
					position: 'is-bottom',
					message,
					type
				});
			}

			this.$store.dispatch('alert/clear', null);
		});
	},
	mounted() {
		// eslint-disable-next-line no-console
		console.log(
			`%c Hostess %c ${this.config.version} %c`,
			'background:#35495e; padding: 1px; border-radius: 3px 0 0 3px;  color: #fff',
			'background:#ff015b; padding: 1px; border-radius: 0 3px 3px 0;  color: #fff',
			'background:transparent'
		);
	}
};
</script>

<style lang="scss">
@import '~/assets/styles/style.scss';
html {
	overflow: hidden !important;
}
.is-fullheight {
	min-height: 100vh !important;
	height: max-content;
}
.nuxt-app > .section {
	min-height: auto !important;
	height: auto !important;
}
</style>
<style lang="scss" scoped>
.default-body {
	align-items: baseline !important;
	overflow: auto;
	height: 100vh;
	.background {
		position: fixed;
		top: 0;
		left: 0;
		background: no-repeat scroll 50% 50%;
		background-size: cover;
		z-index: -1;
		height: 100vh;
		width: 100%;
		pointer-events: none;
		// background-image: url('~assets/images/background.jpg');
		// Uncomment the following to test different backgrounds
		/*
			top: -10%;
			left: -10%;
			height: 120vh;
			width: 120%;
			filter: blur(15px);
		*/
	}
}
.scroll-area {
	height: 100vh;
}
</style>
